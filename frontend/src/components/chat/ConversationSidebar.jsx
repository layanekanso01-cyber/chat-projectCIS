import { Button } from "@/components/ui/button";

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelect,
  onNewChat,
  isLoading,
}) {
  return (
    <div className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-50">
      <div className="border-b border-gray-200 p-3">
        <Button onClick={onNewChat} variant="outline" size="sm" className="w-full">
          New chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="px-3 py-2 text-xs text-gray-400">Loading...</p>
        )}
        {!isLoading && conversations.length === 0 && (
          <p className="px-3 py-2 text-xs text-gray-400">No conversations yet.</p>
        )}
        {conversations.map((conversation) => (
          <button
            key={conversation.conversation_id}
            onClick={() => onSelect(conversation.conversation_id)}
            className={`block w-full truncate px-3 py-2 text-left text-xs ${
              conversation.conversation_id === activeConversationId
                ? "bg-blue-100 text-blue-900"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            {conversation.preview || "New conversation"}
          </button>
        ))}
      </div>
    </div>
  );
}
