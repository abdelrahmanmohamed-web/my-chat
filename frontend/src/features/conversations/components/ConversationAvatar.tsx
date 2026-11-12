import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarInitials } from "@/lib/date";

interface ConversationAvatarProps {
  name: string | null | undefined;
  avatarUrl?: string | null;
  size?: "sm" | "default" | "lg";
}

export function ConversationAvatar({
  name,
  avatarUrl,
  size = "default",
}: ConversationAvatarProps) {
  const displayName = name?.trim() || "محادثة";

  return (
    <Avatar size={size}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
      <AvatarFallback>{getAvatarInitials(displayName)}</AvatarFallback>
    </Avatar>
  );
}
