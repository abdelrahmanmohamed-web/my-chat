import { MessageSquareIcon, MessageSquarePlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ChatEmptyStateProps {
  onStartConversation: () => void;
}

export function ChatEmptyState({ onStartConversation }: ChatEmptyStateProps) {
  return (
    <section
      aria-label="ترحيب المحادثات"
      className="flex h-full flex-col items-center justify-center gap-4 bg-chat-bg p-8 text-center"
    >
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <MessageSquareIcon className="size-8" aria-hidden="true" />
      </div>

      <div className="flex max-w-sm flex-col gap-1.5">
        <h1 className="text-xl font-semibold text-foreground">
          اختر محادثة للبدء
        </h1>
        <p className="text-sm text-muted-foreground">
          حدد محادثة من القائمة الجانبية أو ابدأ محادثة جديدة مع أي مستخدم.
        </p>
      </div>

      <Button type="button" onClick={onStartConversation}>
        <MessageSquarePlusIcon data-icon="inline-start" aria-hidden="true" />
        <span>محادثة جديدة</span>
      </Button>
    </section>
  );
}
