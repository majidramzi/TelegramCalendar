import { MAX_EVENT_PHOTO_BYTES } from "@tg-cal/shared/photo";

/** Resize/compress a picked image for upload (JPEG, max edge 1280). */
export async function compressEventPhoto(
  file: File,
): Promise<{ base64: string; mime: string }> {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = 0.85;
  let blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  while (blob && blob.size > MAX_EVENT_PHOTO_BYTES && quality > 0.4) {
    quality -= 0.1;
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
  }
  if (!blob || blob.size > MAX_EVENT_PHOTO_BYTES) {
    throw new Error("Photo is too large (max 2 MB)");
  }

  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return { base64: btoa(binary), mime: "image/jpeg" };
}
