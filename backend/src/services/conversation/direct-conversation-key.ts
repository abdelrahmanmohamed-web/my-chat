/** Produces the same identity for a direct pair regardless of ordering. */
export function directConversationKey(firstId: string, secondId: string): string {
  return [firstId, secondId].sort().join(":");
}
