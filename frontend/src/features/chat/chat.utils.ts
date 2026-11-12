export type MessageSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?)]+$/;

/**
 * Safely splits plain-text message content into text and HTTP(S) link segments.
 * Never parses HTML; callers render link elements explicitly.
 */
export function parseMessageSegments(content: string): MessageSegment[] {
  if (!content) {
    return [];
  }

  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(URL_REGEX)) {
    const rawUrl = match[0];
    const startIndex = match.index ?? 0;

    if (startIndex > lastIndex) {
      segments.push({
        type: "text",
        value: content.slice(lastIndex, startIndex),
      });
    }

    const trimmedTrailing = rawUrl.replace(TRAILING_PUNCTUATION_REGEX, "");
    const trailingChars = rawUrl.slice(trimmedTrailing.length);

    if (trimmedTrailing.length > 0) {
      segments.push({
        type: "link",
        value: trimmedTrailing,
        href: trimmedTrailing,
      });
    }

    if (trailingChars.length > 0) {
      segments.push({
        type: "text",
        value: trailingChars,
      });
    }

    lastIndex = startIndex + rawUrl.length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: "text",
      value: content.slice(lastIndex),
    });
  }

  return segments;
}
