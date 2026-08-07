"use client";

import type { Attachment } from "./workspace";

/** Only these are accepted — covers .png, .jpg and .jpeg. */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(",");
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 4;

export type ReadResult = {
  attachments: Attachment[];
  errors: string[];
};

function isAccepted(type: string): type is Attachment["mimeType"] {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Validates and reads image files into data URLs. Rejections are returned
 * rather than thrown so the composer can show them all at once.
 */
export async function readImageFiles(files: File[]): Promise<ReadResult> {
  const attachments: Attachment[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (!isAccepted(file.type)) {
      errors.push(`${file.name}: only JPG and PNG images are supported`);
      continue;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      errors.push(
        `${file.name}: ${formatSize(file.size)} exceeds the ${formatSize(
          MAX_ATTACHMENT_BYTES
        )} limit`
      );
      continue;
    }
    try {
      attachments.push({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type,
        dataUrl: await readAsDataUrl(file),
      });
    } catch {
      errors.push(`${file.name}: could not be read`);
    }
  }

  return { attachments, errors };
}
