/**
 * Company logo validation + serialization. Shared by the companies list and
 * single-company routes, which both need to accept/return the same shape.
 *
 * Same convention as report branding (lib/services/report-settings.ts):
 * base64 in Postgres, not a blob-store URL — logos are small brand marks and
 * this app has no persistent blob store configured.
 */

/** Logos are small brand marks, not photos. 1 MB is generous. */
export const MAX_LOGO_BYTES = 1024 * 1024;
export const ALLOWED_LOGO_TYPES = new Set(["image/png", "image/jpeg"]);

export class LogoValidationError extends Error {}

/** Throws LogoValidationError on anything wrong with a proposed logo upload. */
export function validateLogoInput(logoBase64: unknown, logoMimeType: unknown): void {
  if (typeof logoBase64 !== "string") return;
  const bytes = Buffer.from(logoBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new LogoValidationError("Logo image is not valid base64.");
  }
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new LogoValidationError(
      `The logo is ${(bytes.byteLength / 1024).toFixed(0)} KB; the limit is ${(MAX_LOGO_BYTES / 1024).toFixed(0)} KB.`
    );
  }
  if (typeof logoMimeType !== "string" || !ALLOWED_LOGO_TYPES.has(logoMimeType)) {
    throw new LogoValidationError("Logo must be image/png or image/jpeg.");
  }
}

type CompanyForSerialization = {
  id: string;
  name: string;
  country: string | null;
  isActive: boolean;
  logoBase64: string | null;
  logoMimeType: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { users: number };
};

export function serializeCompany(company: CompanyForSerialization) {
  return {
    id: company.id,
    name: company.name,
    country: company.country,
    isActive: company.isActive,
    logoDataUrl:
      company.logoBase64 && company.logoMimeType
        ? `data:${company.logoMimeType};base64,${company.logoBase64}`
        : null,
    userCount: company._count.users,
    createdAt: company.createdAt,
    updatedAt: company.updatedAt,
  };
}
