"use client";

/**
 * Browser client for `/api/v1/report-settings` — the company name and logo
 * stamped on generated ESG/GHG reports.
 */

export type ReportSettings = {
  object: "report_settings";
  company_name: string;
  has_custom_logo: boolean;
  logo_data_url: string | null;
  updated_at: string;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId: string | null
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiRequestError(
      body?.message ?? `The request failed with status ${response.status}.`,
      body?.code ?? "unknown_error",
      body?.request_id ?? null
    );
  }

  return body as T;
}

export function fetchReportSettings(): Promise<ReportSettings> {
  return request<ReportSettings>("/report-settings");
}

export function updateReportSettings(input: {
  company_name?: string;
  logo_base64?: string;
  logo_mime_type?: string;
  remove_logo?: boolean;
}): Promise<ReportSettings> {
  return request<ReportSettings>("/report-settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Reads an image File into a base64 string (no data: URL prefix) plus its MIME type. */
export function readLogoFile(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.slice(result.indexOf(",") + 1);
      resolve({ base64, mimeType: file.type });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
