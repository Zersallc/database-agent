# Document libraries: the Developer UI

How the Document libraries tab under **Database Mapping** works, and — more
usefully — what it deliberately does not do. Read this before assuming a
library listed there is searchable.

## Where it lives and who sees it

The tab sits beside **Databases** on `/database-mapping`. The page itself is
admin-gated, so an Admin can open it; only a **Developer** is shown the
Document libraries tab.

That hiding is presentation. The boundary is `requireDeveloperRole` on every
route under `/api/v1/companies/{company_id}/media-connections`, which re-reads
the role from Postgres on each request and refuses an API key outright. An
Admin who reached the tab by other means would get `403 insufficient_role` from
every button on it.

A Developer picks the company at the top of the tab. Media connections belong
to one company each; nothing here lets one company's records be read or
changed from another's, because the company is a path segment the server
authorizes rather than a filter the browser applies.

## What "enabled" means, and what it does not

`enabled` is one of **three** conditions. A library is actually searchable only
when all three hold:

1. the connection is `enabled` — the switch in this tab;
2. an operator has created the matching library on syslab-server and linked it
   to this connection's alias — outside this UI entirely;
3. `MEDIA_CONNECTIONS_ENABLED` is on for the deployment — an environment
   variable, off by default.

A new library is therefore created **switched off**, and the UI never says a
library is live. The browser has no way to read (3): there is no endpoint that
reports the flag, and A5 deliberately did not add one. So the wording in the
tab makes no claim about deployment availability at all, which is the honest
option but does mean a Developer can switch a library on and see nothing change
in chat. Checking the flag is currently an operator/console task.

## The fields

**Name** — shown to the agent, unique within the company across databases and
document libraries. Max 120 characters.

**Description** — what the library holds, in an administrator's words. The
agent reads it when deciding whether to search. Max 2,000 characters.

**Operator note** (`library_ref`) — a reminder for people of which syslab
library this record stands for. It is **not** a routing or authorization input:
nothing branches on it, it is never sent to syslab-server, and it is never
shown to the model. Max 200 characters, restricted to letters, digits, spaces
and `. _ - : /` as a storage safety net, not because any real library id has to
look like that.

**Document server** (`server_ref`) — names a deployment the environment is
configured for; only `default` exists today. The server's URL and token live in
deployment configuration and never appear in this UI, in a request body, in a
response, or in the record.

**Not editable, not enterable anywhere:** the alias (`alias_id`). It is the
connection's own id, assigned at creation, never accepted from a caller and
never serialized to the browser. `server_ref` is likewise fixed at creation.

## Status is not a connectivity check

The API reports `status: "unknown"` for every media connection, because there
is no media connectivity probe — the databases tab's SQL **Test** button has no
counterpart here, and A5 was not allowed to add one. The tab therefore shows
**Not checked**, never anything that could be read as a successful connection.
A library that is misconfigured on the syslab side looks exactly like one that
is fine until someone asks the agent a question.

## Editing limitations carried over from A4

The PATCH route cannot currently **clear** `description` or `library_ref`: the
validation layer collapses an explicitly-empty field and an omitted one into
the same thing, so there is no way to express "erase this". The edit dialog
omits a blanked field rather than pretending, keeps the saved value, and says
so next to the field. Replacing the text works normally.

Name uniqueness is also one-directional today: creating a document library is
refused if a database connection in that company already has the name, but
creating a *database* connection does not check the other way.

## Deleting

Removing a library takes it away from the agent for that company immediately.
It does **not** delete anything on syslab-server — the documents, the library
and possibly a stale alias link stay there, and retiring them is an operator
step. The confirmation dialog says this.

## What this UI does not do

No uploading, no provisioning, no indexing, no connectivity test, no per-user
or per-conversation scoping, and no access to another company's records. Access
is company-level: every user of a company sees the same enabled libraries as
every other. Uploading documents and creating the syslab library remain
operator work outside this application.
