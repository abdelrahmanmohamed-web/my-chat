import { format, isSameDay, isToday, isYesterday } from "date-fns";
import { ar } from "date-fns/locale";

function parseValidDate(isoDate: string | null | undefined): Date | null {
  if (!isoDate) {
    return null;
  }
  const parsed = new Date(isoDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Formats conversation activity timestamps for sidebar items in Arabic locale.
 */
export function formatConversationListTime(
  isoDate: string | null | undefined,
): string {
  const date = parseValidDate(isoDate);
  if (!date) {
    return "";
  }
  if (isToday(date)) {
    return format(date, "p", { locale: ar });
  }
  if (isYesterday(date)) {
    return "أمس";
  }
  return format(date, "d MMM", { locale: ar });
}

/**
 * Formats message bubble timestamps in Arabic short time format.
 */
export function formatMessageTime(isoDate: string): string {
  const date = parseValidDate(isoDate);
  if (!date) {
    return "";
  }
  return format(date, "p", { locale: ar });
}

/**
 * Formats chat timeline day separator pills ("اليوم", "أمس", or full date).
 */
export function formatMessageDateSeparator(isoDate: string): string {
  const date = parseValidDate(isoDate);
  if (!date) {
    return "";
  }
  if (isToday(date)) {
    return "اليوم";
  }
  if (isYesterday(date)) {
    return "أمس";
  }
  return format(date, "d MMMM yyyy", { locale: ar });
}

/**
 * Checks whether two ISO timestamps belong to different local calendar days.
 */
export function isDifferentCalendarDay(aIso: string, bIso: string): boolean {
  const dateA = parseValidDate(aIso);
  const dateB = parseValidDate(bIso);
  if (!dateA || !dateB) {
    return false;
  }
  return !isSameDay(dateA, dateB);
}

/**
 * Extracts 1-2 avatar fallback initials from a display name.
 */
export function getAvatarInitials(name: string | null | undefined): string {
  const normalized = name?.trim();
  if (!normalized) {
    return "؟";
  }

  const parts = normalized.split(/\s+/);
  if (parts.length === 1) {
    return Array.from(parts[0]).slice(0, 2).join("");
  }

  const first = Array.from(parts[0])[0] ?? "";
  const second = Array.from(parts[1])[0] ?? "";
  return `${first}${second}`.trim() || "؟";
}
