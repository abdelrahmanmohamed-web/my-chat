import { useState, type FormEvent, type KeyboardEvent } from "react";
import { SendHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGE_LIMITS, sendMessageSchema } from "@/types/messages";

interface MessageComposerProps {
  disabled?: boolean;
  onSend: (content: string) => void;
}

export function MessageComposer({
  disabled = false,
  onSend,
}: MessageComposerProps) {
  const [content, setContent] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function submitMessage() {
    if (disabled) {
      return;
    }

    const parsed = sendMessageSchema.safeParse({ content });
    if (!parsed.success) {
      if (content.trim().length > MESSAGE_LIMITS.contentMaxLength) {
        setValidationError(
          parsed.error.issues[0]?.message ?? "الرسالة طويلة جداً.",
        );
      }
      return;
    }

    setValidationError(null);
    setContent("");
    onSend(parsed.data.content);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  const canSend = !disabled && content.trim().length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-1.5 border-t border-border bg-panel-header px-3 py-2.5"
    >
      {validationError && (
        <p role="alert" className="text-xs text-destructive">
          {validationError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Textarea
          dir="rtl"
          rows={1}
          value={content}
          disabled={disabled}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            setContent(event.target.value);
            if (validationError) {
              setValidationError(null);
            }
          }}
          placeholder="اكتب رسالة..."
          aria-label="نص الرسالة"
          className="max-h-32 min-h-9 flex-1 resize-none bg-background py-1.5 text-start"
        />

        <Button
          type="submit"
          size="icon-lg"
          disabled={!canSend}
          aria-label="إرسال الرسالة"
        >
          <SendHorizontalIcon className="rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
