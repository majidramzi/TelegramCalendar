/** Max decoded photo size stored per event. */
export const MAX_EVENT_PHOTO_BYTES = 2 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function isAllowedPhotoMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime.toLowerCase());
}

export function decodeEventPhotoBase64(
  base64: string,
  mime: string,
): { bytes: Uint8Array; mime: string } | { error: string } {
  const cleanMime = mime.trim().toLowerCase();
  if (!isAllowedPhotoMime(cleanMime)) {
    return { error: "Photo must be JPEG, PNG, WebP, or GIF" };
  }
  const raw = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!raw) return { error: "Empty photo data" };
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(raw, "base64"));
  } catch {
    return { error: "Invalid photo data" };
  }
  if (!bytes.length) return { error: "Empty photo data" };
  if (bytes.length > MAX_EVENT_PHOTO_BYTES) {
    return { error: "Photo is too large (max 2 MB)" };
  }
  return { bytes, mime: cleanMime };
}

export function photoExtension(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}
