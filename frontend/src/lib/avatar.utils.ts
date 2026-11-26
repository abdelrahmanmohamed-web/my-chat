export const ALLOWED_AVATAR_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

const ALLOWED_AVATAR_MIME_SET = new Set<string>(ALLOWED_AVATAR_MIME_TYPES);

export const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_AVATAR_INPUT_BYTES = 10 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 256;

async function resizeImageToAvatarBlob(
  file: File,
): Promise<{ blob: Blob; mimeType: string } | null> {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return null;
  }

  const canvas = document.createElement("canvas");
  const ctx =
    typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (!ctx) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Image decode failed"));
      element.src = objectUrl;
    });

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) {
      return null;
    }

    const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const outputMime =
      file.type === "image/png" ? "image/png" : "image/jpeg";
    const exported = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, outputMime, 0.85);
    });

    if (!exported || exported.size === 0) {
      return null;
    }

    if (exported.size >= file.size && file.size <= MAX_AVATAR_UPLOAD_BYTES) {
      return { blob: file, mimeType: file.type };
    }

    return { blob: exported, mimeType: exported.type || outputMime };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Validates and optionally downscales a selected image file before uploading as an avatar.
 */
export async function prepareAvatarUpload(
  file: File,
): Promise<{ blob: Blob; mimeType: string }> {
  if (!ALLOWED_AVATAR_MIME_SET.has(file.type)) {
    throw new Error(
      "صيغة الملف غير مدعومة. اختر صورة بصيغة PNG أو JPG أو WebP أو GIF.",
    );
  }

  if (file.size === 0) {
    throw new Error("ملف الصورة فارغ.");
  }

  if (file.size > MAX_AVATAR_INPUT_BYTES) {
    throw new Error("حجم الصورة كبير جداً. الحد الأقصى للملف هو 10 ميجابايت.");
  }

  if (file.type === "image/gif") {
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      throw new Error("حجم صورة GIF يجب ألا يتجاوز 2 ميجابايت.");
    }
    return { blob: file, mimeType: file.type };
  }

  const resized = await resizeImageToAvatarBlob(file);
  if (resized && resized.blob.size <= MAX_AVATAR_UPLOAD_BYTES) {
    return resized;
  }

  if (file.size <= MAX_AVATAR_UPLOAD_BYTES) {
    return { blob: file, mimeType: file.type };
  }

  throw new Error("حجم الصورة بعد الضغط ما زال يتجاوز الحد الأقصى (2 ميجابايت).");
}
