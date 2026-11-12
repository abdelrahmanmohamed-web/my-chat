import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  CONVERSATION_LIMITS,
  conversationUpdateSchema,
  type Conversation,
} from "@/types/conversations";
import { useUpdateConversationMutation } from "../use-conversations";

interface EditConversationFormProps {
  conversation: Conversation;
  onClose: () => void;
}

function EditConversationForm({
  conversation,
  onClose,
}: EditConversationFormProps) {
  const [nameInput, setNameInput] = useState(conversation.name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const updateMutation = useUpdateConversationMutation();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = nameInput.trim();
    const parsed = conversationUpdateSchema.safeParse({
      name: trimmed.length > 0 ? trimmed : null,
    });

    if (!parsed.success) {
      setNameError(parsed.error.issues[0]?.message ?? "اسم المحادثة غير صالح");
      return;
    }

    setNameError(null);
    try {
      await updateMutation.mutateAsync({
        conversationId: conversation._id,
        payload: parsed.data,
      });
      onClose();
    } catch {
      // Handled centrally by mutation onError toast.
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Field data-invalid={Boolean(nameError)}>
        <FieldLabel htmlFor="edit-conversation-name">اسم المحادثة</FieldLabel>
        <Input
          id="edit-conversation-name"
          dir="rtl"
          className="text-start"
          maxLength={CONVERSATION_LIMITS.nameMaxLength}
          value={nameInput}
          onChange={(event) => setNameInput(event.target.value)}
          aria-invalid={Boolean(nameError)}
          disabled={updateMutation.isPending}
          autoFocus
        />
        <FieldDescription>
          بحد أقصى {CONVERSATION_LIMITS.nameMaxLength} حرفاً.
        </FieldDescription>
        {nameError && <FieldError>{nameError}</FieldError>}
      </Field>

      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={updateMutation.isPending}
          onClick={onClose}
        >
          إلغاء
        </Button>
        <Button type="submit" disabled={updateMutation.isPending}>
          {updateMutation.isPending && (
            <Spinner className="size-4" aria-hidden="true" />
          )}
          <span>حفظ</span>
        </Button>
      </DialogFooter>
    </form>
  );
}

interface EditConversationDialogProps {
  conversation: Conversation | null;
  onOpenChange: (open: boolean) => void;
}

export function EditConversationDialog({
  conversation,
  onOpenChange,
}: EditConversationDialogProps) {
  return (
    <Dialog open={conversation !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>تعديل اسم المحادثة</DialogTitle>
          <DialogDescription>
            عيّن اسماً مخصصاً لهذه المحادثة، أو اتركه فارغاً لاستخدام اسم الطرف
            الآخر تلقائياً.
          </DialogDescription>
        </DialogHeader>

        {conversation && (
          <EditConversationForm
            key={conversation._id}
            conversation={conversation}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
