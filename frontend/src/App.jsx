import { useEffect, useState } from "react";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatViewport } from "@/components/chat/ChatViewport";
import { ChatInput } from "@/components/chat/ChatInput";
import { ConversationSidebar } from "@/components/chat/ConversationSidebar";
import { useChatStream } from "@/hooks/useChatStream";

const API_URL = "http://127.0.0.1:8000";

const INITIAL_MESSAGES = [
  {
    id: "welcome",
    role: "assistant",
    content: "Ask me a question about the CIS Controls v8 document.",
    sources: [],
  },
];

function mapStoredMessage(message) {
  return {
    id: message.id,
    serverId: message.id,
    role: message.role,
    content: message.content,
    sources: message.sources || [],
    feedback: message.feedback ?? null,
    versions:
      message.versions && message.versions.length > 0
        ? message.versions
        : [{ content: message.content, sources: message.sources || [] }],
    activeVersionIndex: message.active_version ?? 0,
    isStreaming: false,
  };
}

function App() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const { sendMessage, regenerateMessage, isStreaming } = useChatStream();

  useEffect(() => {
    refreshConversations();
  }, []);

  async function refreshConversations() {
    setIsLoadingConversations(true);
    try {
      const response = await fetch(`${API_URL}/conversations`);
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      setConversations(await response.json());
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingConversations(false);
    }
  }

  async function handleSelectConversation(id) {
    if (id === conversationId || isStreaming) return;
    try {
      const response = await fetch(`${API_URL}/conversations/${id}`);
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
      const data = await response.json();
      setConversationId(data._id);
      setMessages(data.messages.map(mapStoredMessage));
    } catch (error) {
      console.error(error);
    }
  }

  function handleNewChat() {
    if (isStreaming) return;
    setConversationId(null);
    setMessages(INITIAL_MESSAGES);
  }

  async function handleSend(text) {
    const userMessage = { id: `user_${Date.now()}`, role: "user", content: text };
    const assistantMessageId = `assistant_${Date.now()}`;
    const assistantMessage = {
      id: assistantMessageId,
      serverId: null,
      role: "assistant",
      content: "",
      sources: [],
      feedback: null,
      versions: [],
      activeVersionIndex: 0,
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    function updateAssistantMessage(updater) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId ? updater(message) : message
        )
      );
    }

    await sendMessage(text, conversationId, {
      onSources: (sources) => {
        updateAssistantMessage((message) => ({ ...message, sources }));
      },
      onToken: (token) => {
        updateAssistantMessage((message) => ({
          ...message,
          content: message.content + token,
        }));
      },
      onDone: ({ conversation_id, message_id }) => {
        setConversationId(conversation_id);
        updateAssistantMessage((message) => ({
          ...message,
          serverId: message_id,
          isStreaming: false,
          versions: [{ content: message.content, sources: message.sources }],
          activeVersionIndex: 0,
        }));
        refreshConversations();
      },
      onError: (detail) => {
        console.error(detail);
        updateAssistantMessage((message) => ({
          ...message,
          content:
            message.content || "Sorry, something went wrong reaching the backend.",
          isStreaming: false,
        }));
      },
    });
  }

  async function handleFeedback(clientMessageId, feedback, feedbackReason) {
    const message = messages.find((item) => item.id === clientMessageId);
    if (!message?.serverId || !conversationId) return;

    setMessages((prev) =>
      prev.map((item) =>
        item.id === clientMessageId ? { ...item, feedback } : item
      )
    );

    try {
      const response = await fetch(
        `${API_URL}/conversations/${conversationId}/messages/${message.serverId}/feedback`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback, feedback_reason: feedbackReason ?? null }),
        }
      );
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    } catch (error) {
      console.error(error);
    }
  }

  async function handleRegenerate(clientMessageId) {
    const message = messages.find((item) => item.id === clientMessageId);
    if (!message?.serverId || !conversationId || isStreaming) return;

    function updateMessage(updater) {
      setMessages((prev) =>
        prev.map((item) => (item.id === clientMessageId ? updater(item) : item))
      );
    }

    // Re-use the pending/streaming bubble state, same as a fresh send.
    updateMessage((item) => ({ ...item, content: "", isStreaming: true }));

    await regenerateMessage(conversationId, message.serverId, {
      onSources: (sources) => {
        updateMessage((item) => ({ ...item, sources }));
      },
      onToken: (token) => {
        updateMessage((item) => ({ ...item, content: item.content + token }));
      },
      onDone: () => {
        updateMessage((item) => {
          const newVersions = [
            ...item.versions,
            { content: item.content, sources: item.sources },
          ];
          return {
            ...item,
            versions: newVersions,
            activeVersionIndex: newVersions.length - 1,
            isStreaming: false,
          };
        });
        refreshConversations();
      },
      onError: (detail) => {
        console.error(detail);
        updateMessage((item) => ({ ...item, isStreaming: false }));
      },
    });
  }

  async function handleSwitchVersion(clientMessageId, targetIndex) {
    const message = messages.find((item) => item.id === clientMessageId);
    if (!message?.serverId || !conversationId) return;
    if (targetIndex < 0 || targetIndex >= message.versions.length) return;

    const targetVersion = message.versions[targetIndex];
    setMessages((prev) =>
      prev.map((item) =>
        item.id === clientMessageId
          ? {
              ...item,
              content: targetVersion.content,
              sources: targetVersion.sources,
              activeVersionIndex: targetIndex,
            }
          : item
      )
    );

    try {
      const response = await fetch(
        `${API_URL}/conversations/${conversationId}/messages/${message.serverId}/active-version`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version_index: targetIndex }),
        }
      );
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div className="flex h-screen bg-white">
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={conversationId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        isLoading={isLoadingConversations}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeader />
        <ChatViewport
          messages={messages}
          onFeedback={handleFeedback}
          onRegenerate={handleRegenerate}
          onSwitchVersion={handleSwitchVersion}
        />
        {isStreaming && (
          <p className="px-4 text-xs text-gray-400 pb-1">Generating...</p>
        )}
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>
    </div>
  );
}

export default App;
