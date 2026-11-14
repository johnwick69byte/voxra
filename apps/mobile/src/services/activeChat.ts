/** Conversation id of the thread currently on screen. Used to suppress its push. */
let openConversationId: string | null = null;

export function setOpenChatThread(conversationId: string | null) {
  openConversationId = conversationId;
}

export function isChatThreadOpen(conversationId?: string | null) {
  return !!conversationId && openConversationId === conversationId;
}
