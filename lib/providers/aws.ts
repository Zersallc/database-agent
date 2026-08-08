/**
 * AWS drivers.
 *
 * Google Cloud is the default, but "the backend runs on GCP" and "every
 * customer's data lives on GCP" are different claims. A tenant with a data
 * residency requirement, an existing S3 estate, or a contractual objection to
 * Google gets S3 here without anything above the provider interface changing.
 *
 * Credentials come from the standard AWS chain — instance role, Workload
 * Identity Federation, or the environment. No key handling in this file.
 */

import { optionalModule } from "./optional-module";
import type { BlobMetadata, BlobStore } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- optional SDKs are untyped here by design */

export type S3Config = {
  bucket: string;
  region: string;
  /** Set for S3-compatible stores (MinIO, R2, Ceph). Omit for AWS proper. */
  endpoint?: string;
  prefix?: string;
};

export class S3BlobStore implements BlobStore {
  readonly driver = "s3";
  private sdk: Promise<{ client: any; commands: Record<string, any>; presign: any }> | null = null;

  constructor(private readonly config: S3Config) {}

  private load() {
    this.sdk ??= (async () => {
      const s3 = await optionalModule("@aws-sdk/client-s3", "the S3 driver");
      const presigner = await optionalModule(
        "@aws-sdk/s3-request-presigner",
        "S3 signed download URLs"
      );
      const S3Client = s3.S3Client as new (options: object) => any;
      return {
        client: new S3Client({
          region: this.config.region,
          ...(this.config.endpoint ? { endpoint: this.config.endpoint, forcePathStyle: true } : {}),
        }),
        commands: s3 as Record<string, any>,
        presign: presigner.getSignedUrl,
      };
    })();
    return this.sdk;
  }

  private path(key: string): string {
    return this.config.prefix ? `${this.config.prefix.replace(/\/$/, "")}/${key}` : key;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<BlobMetadata> {
    const { client, commands } = await this.load();
    await client.send(
      new commands.PutObjectCommand({
        Bucket: this.config.bucket,
        Key: this.path(key),
        Body: body,
        ContentType: contentType,
      })
    );
    return { key, size: body.byteLength, contentType };
  }

  async get(key: string) {
    const { client, commands } = await this.load();
    try {
      const response = await client.send(
        new commands.GetObjectCommand({ Bucket: this.config.bucket, Key: this.path(key) })
      );
      const bytes = new Uint8Array(await response.Body.transformToByteArray());
      return {
        body: bytes,
        metadata: {
          key,
          size: Number(response.ContentLength ?? bytes.byteLength),
          contentType: String(response.ContentType ?? "application/octet-stream"),
        },
      };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const { client, commands } = await this.load();
    await client.send(
      new commands.DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.path(key) })
    );
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    try {
      const { client, commands, presign } = await this.load();
      return await presign(
        client,
        new commands.GetObjectCommand({ Bucket: this.config.bucket, Key: this.path(key) }),
        { expiresIn: expiresInSeconds }
      );
    } catch {
      return null;
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const { client, commands } = await this.load();
      await client.send(new commands.HeadBucketCommand({ Bucket: this.config.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
