/**
 * Demo-only shortcut: the image is carried as a data URL and lands in
 * localStorage with the conversation. Real uploads go to object storage and
 * this becomes a signed URL.
 */
export type Attachment = {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg";
  dataUrl: string;
};

export type ConnectionStatus = "connected" | "degraded" | "offline" | "unknown";
