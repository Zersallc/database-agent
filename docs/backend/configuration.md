# Backend configuration

The backend targets Google Cloud, but nothing above the provider interface knows
that. Storage, coordination, secrets, and every database connector are selected
from configuration at boot, so a deployment can run entirely on GCP, put a
tenant's attachments on S3, or run on a laptop with none of it.

Defaults are in-memory across the board. That is what lets `npm run dev` work
with no account, no credentials, and no `.env` — and it is a development
affordance, not a deployment story. `GET /v1/health` says so out loud when a
memory driver is active.

## Providers

Four interfaces, in [`lib/providers/types.ts`](../../lib/providers/types.ts).

| Interface | What it holds | Drivers |
|---|---|---|
| `DocumentStore` | Connections, conversations, messages, runs, queries, playbook, users | `memory`, `firestore` |
| `KeyValueStore` | Rate-limit counters, idempotency records, schema cache | `memory`, `firestore` |
| `BlobStore` | Attachments | `memory`, `gcs`, `s3` |
| `SecretStore` | Database credentials | `env`, `gcp-secret-manager` |

Cloud SDKs are **optional dependencies**, loaded at runtime. A GCP deployment
installs the Google packages; an AWS one installs the AWS packages; a laptop
installs neither. Nothing forces every install to carry every cloud's SDK.

```bash
# Google Cloud
npm install @google-cloud/firestore @google-cloud/storage @google-cloud/secret-manager

# AWS object storage
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# Database connectors — only the engines you actually attach
npm install pg              # PostgreSQL, Cloud SQL, AlloyDB
npm install mysql2          # MySQL, MariaDB
npm install @google-cloud/bigquery

# The agent
npm install @anthropic-ai/sdk
```

A missing package is not a crash — the endpoint that needed it returns
`503 provider_unavailable` with the exact `npm install` line to run.

## Environment variables

Nothing is required. Everything below changes a default.

### Providers

| Variable | Default | Notes |
|---|---|---|
| `METADATA_DRIVER` | `memory` | `memory` \| `firestore` |
| `KV_DRIVER` | `memory` | `memory` \| `firestore` |
| `BLOB_DRIVER` | `memory` | `memory` \| `gcs` \| `s3` |
| `SECRET_DRIVER` | `env` | `env` \| `gcp-secret-manager` |

### Google Cloud

| Variable | Notes |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | Project ID. Required for Secret Manager |
| `FIRESTORE_DATABASE_ID` | Named database. Omit for the project default |
| `FIRESTORE_ROOT_COLLECTION` | Default `tenants`. Lets several environments share a project |
| `KV_COLLECTION` | Default `kv` |
| `GCS_BUCKET`, `GCS_PREFIX` | Bucket for attachments |
| `SECRET_MANAGER_PREFIX` | Prepended to every secret name, e.g. `dbagent-prod` |

Authentication is Application Default Credentials throughout — the service
account attached to the Cloud Run revision in production,
`gcloud auth application-default login` locally. No key files.

### AWS

| Variable | Notes |
|---|---|
| `S3_BUCKET`, `AWS_REGION` | Required for `BLOB_DRIVER=s3` |
| `S3_ENDPOINT` | For S3-compatible stores (MinIO, R2, Ceph) |
| `S3_PREFIX` | Key prefix |

### Agent

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Without it, runs return the setup notice instead of an answer |
| `AGENT_MODEL` | `claude-opus-5` | |
| `AGENT_EFFORT` | `high` | `low` \| `medium` \| `high` \| `xhigh` \| `max` |
| `BIGQUERY_MAX_BYTES_BILLED` | 1 GiB | Per-query ceiling — a runaway query fails cheaply instead of succeeding expensively |

### Limits and behavior

| Variable | Default |
|---|---|
| `RATE_LIMIT_READ` / `_WRITE` / `_QUERY` / `_RUN` | 600 / 120 / 60 / 30 per minute |
| `SCHEMA_CACHE_TTL_SECONDS` | 900 |
| `MAX_UPLOAD_BYTES` | 20 MiB |
| `API_AUTH_MODE` | `open` in development; always `required` in production |
| `WORKSPACE_NAME`, `BOOTSTRAP_USER_NAME`, `BOOTSTRAP_USER_EMAIL` | Seed values for the local workspace |

## Deploying to Google Cloud

A minimal Cloud Run deployment:

```bash
gcloud run deploy database-agent \
  --source . \
  --region us-central1 \
  --service-account database-agent@PROJECT.iam.gserviceaccount.com \
  --set-env-vars METADATA_DRIVER=firestore,KV_DRIVER=firestore,BLOB_DRIVER=gcs,SECRET_DRIVER=gcp-secret-manager,GOOGLE_CLOUD_PROJECT=PROJECT,GCS_BUCKET=BUCKET \
  --set-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest
```

The service account needs `roles/datastore.user`,
`roles/storage.objectAdmin` on the bucket, and
`roles/secretmanager.admin` (it creates secrets on connection create and adds
versions on credential rotation; `secretAccessor` alone is read-only and is not
enough).

**Signed download URLs** additionally need the service account to be able to sign
— either a private key or `roles/iam.serviceAccountTokenCreator` on itself. Without
it, `signedUrl` returns null and attachments stream through the API instead. That
works, but pays egress twice.

### Firestore indexes

Firestore needs a composite index for each `where` + `orderBy` combination. The
queries that need one:

| Collection | Fields |
|---|---|
| `messages` | `conversation_id` ASC, `created_at` ASC, `id` ASC (and the DESC variant) |
| `connections` | `status` ASC, `created_at` DESC, `id` DESC |
| `users` | `email` ASC, `created_at` ASC, `id` ASC |
| `users` | `role` ASC, `created_at` ASC, `id` ASC |

Firestore's error message on a missing index contains a link that creates it.
Deploy them ahead of traffic rather than discovering them in production.

### Rate limits and idempotency at scale

`KV_DRIVER=memory` on a multi-instance deployment is wrong in a way that will not
look wrong: each instance counts separately, so the effective rate limit is the
configured limit times the instance count, and idempotency keys miss whenever a
retry lands on a different instance. Set `KV_DRIVER=firestore`.

Firestore is a workable home for these but not the best one — they are hot,
small, contended writes. When traffic justifies it, implement `KeyValueStore`
against Memorystore or Redis and change one environment variable. Nothing above
the interface changes.

## Multi-cloud and multi-database

This is not a single-customer product, and two things follow.

**Storage varies per deployment.** A customer with a data-residency requirement
or an existing S3 estate gets `BLOB_DRIVER=s3` and nothing else changes. Adding
Azure Blob Storage means implementing `BlobStore` and adding one case to the
registry.

**Databases vary per connection, within one workspace.** A tenant routinely has a
Postgres primary, a BigQuery warehouse, and a MySQL staging box, and the agent
answers across all of them. Each connection carries its own engine and
credentials; the agent, the query endpoint, and the schema endpoint all speak
[`DataSourceConnector`](../../lib/connectors/types.ts) and none of them know
which engine is on the other side.

Adding an engine: implement the interface, register it in
`lib/connectors/index.ts`, and add the value to the `Engine` enum in the spec.
Nothing else changes. Note the asymmetry — adding an engine to that enum is safe,
removing one is a breaking change, so an engine is listed only once its connector
works.

## Security notes

**Credentials never round-trip.** They are written to the secret store on create
and read only inside a connector call. No endpoint returns them, including the
one that accepted them.

**Read-only is enforced twice, and only one of them counts.**
[`sql-guard.ts`](../../lib/connectors/sql-guard.ts) rejects anything it cannot
prove is a read, which catches an agent that misread a question and produced a
`DELETE`. It is not a security boundary: the agent writes SQL from user text, so
an adversary is in scope, and a parser-free guard cannot hold against one. **Give
the connection a database role without write privileges.** That is the actual
protection; the guard is defense in depth behind it.

**Tenant isolation is structural.** In Firestore every document lives under
`tenants/{tenant_id}/…`, so a query rooted at the wrong tenant cannot reach
another's data even if application code gets a filter wrong. The tenant always
comes from the credential, never from a request body.

**Attachments download as `attachment`, never `inline`**, with
`X-Content-Type-Options: nosniff` — an uploaded SVG or HTML file rendered inline
would execute in this origin.
