import {
  AlertCircleIcon,
  CheckCheckIcon,
  CheckIcon,
  ClockIcon,
} from "lucide-react";
import type { LocalMessageStatus } from "@/types/messages";

interface MessageStatusIconProps {
  localStatus?: LocalMessageStatus;
  isRead: boolean;
}

export function MessageStatusIcon({
  localStatus,
  isRead,
}: MessageStatusIconProps) {
  if (localStatus === "sending") {
    return (
      <ClockIcon
        className="size-3.5 text-bubble-meta"
        aria-label="جاري الإرسال"
      />
    );
  }

  if (localStatus === "failed") {
    return (
      <AlertCircleIcon
        className="size-3.5 text-destructive"
        aria-label="فشل الإرسال"
      />
    );
  }

  if (isRead) {
    return (
      <CheckCheckIcon
        className="size-3.5 text-receipt-read"
        aria-label="مقروء"
      />
    );
  }

  return (
    <CheckIcon className="size-3.5 text-receipt-sent" aria-label="تم الإرسال" />
  );
}
