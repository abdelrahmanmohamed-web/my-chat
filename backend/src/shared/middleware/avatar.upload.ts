/**
 * ============================================================================
 * Avatar Upload Middleware & Image Validation Helpers
 * ============================================================================
 * Shared raw binary body parser and magic-byte detector used by both user
 * profile avatar endpoints and group conversation avatar endpoints.
 * ============================================================================
 */

import express from "express";

export const SUPPORTED_AVATAR_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type SupportedAvatarMime = (typeof SUPPORTED_AVATAR_TYPES)[number];

export const avatarUploadParser = express.raw({
  type: [...SUPPORTED_AVATAR_TYPES],
  limit: "2mb",
});

/**
 * Inspects image magic bytes so uploaded files are verified by content,
 * not solely by the Content-Type header.
 */
export function detectImageMimeType(
  buffer: Buffer,
): SupportedAvatarMime | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (buffer.length >= 6) {
    const header6 = buffer.subarray(0, 6).toString("ascii");
    if (header6 === "GIF87a" || header6 === "GIF89a") {
      return "image/gif";
    }
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Validates raw uploaded image bytes and encodes them as a data URL.
 * Returns null if the body is missing, empty, or fails magic-byte inspection.
 */
export function extractAvatarDataUrl(body: unknown): string | null {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return null;
  }

  const detectedMime = detectImageMimeType(body);
  if (!detectedMime) {
    return null;
  }

  return `data:${detectedMime};base64,${body.toString("base64")}`;
}
