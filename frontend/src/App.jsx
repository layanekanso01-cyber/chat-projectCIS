import { useEffect, useRef, useState } from "react";
import { ChatViewport } from "@/components/chat/ChatViewport";
import { ChatInput } from "@/components/chat/ChatInput";
import { ConversationSidebar } from "@/components/chat/ConversationSidebar";
import { GuidedTour } from "@/components/chat/GuidedTour";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { useChatStream } from "@/hooks/useChatStream";
import { useConversations } from "@/hooks/useConversations";
import * as conversationsApi from "@/api/conversations";
import { logoutRequest } from "@/api/auth";
import { authFetch, onUnauthorized } from "@/api/httpClient";
import { getAccessToken, getRefreshToken, setTokens, clearTokens, hasTokens } from "@/lib/tokenStorage";
import { checklistToMarkdown } from "@/lib/utils";

const PROVIDER_STORAGE_KEY = "provider";
const TOUR_SEEN_STORAGE_KEY = "has_seen_tour";

// Runs once at module load — earlier than any component effect — so that by
// the time hooks like useConversations fire their fetch-on-mount, a token
// captured from a fresh Google-login redirect is already in localStorage.
(function captureTokensFromCallback() {
  const params = new URLSearchParams(window.location.search);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return;

  setTokens({ accessToken, refreshToken });
  const url = new URL(window.location.href);
  url.searchParams.delete("access_token");
  url.searchParams.delete("refresh_token");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
})();

function getInitialProvider() {
  return localStorage.getItem(PROVIDER_STORAGE_KEY) === "gemini" ? "gemini" : "ollama";
}

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
    type: message.type || "text",
    checklist: message.checklist || [],
    sources: message.sources || [],
    feedback: message.feedback ?? null,
    versions:
      message.versions && message.versions.length > 0
        ? message.versions
        : [{ content: message.content, sources: message.sources || [] }],
    activeVersionIndex: message.active_version ?? 0,
    isStreaming: false,
    followUpQuestions: [],
  };
}

function App() {
  // "Ask" and "Compliance Check" are two independent conversation tracks — switching
  // modes must never mix a compliance report into the regular chat thread or vice versa.
  // Each mode remembers its own {conversationId, messages} in modeSlotsRef; switching
  // swaps the visible state instead of re-fetching, so it's instant.
  const [mode, setMode] = useState("ask");
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [conversationId, setConversationId] = useState(null);
  const [authStatus, setAuthStatus] = useState("checking"); // "checking" | "authenticated" | "unauthenticated"
  const [user, setUser] = useState(null);
  const [isTourOpen, setIsTourOpen] = useState(false);
  // Which LLM backend generates answers — a single global choice (not per-conversation),
  // sent with every request. Persisted so it survives a refresh, same as the theme.
  const [provider, setProvider] = useState(getInitialProvider);
  const { sendMessage, regenerateMessage, runComplianceCheck, isStreaming, cancelStream } =
    useChatStream();
  const {
    conversations,
    isLoading: isLoadingConversations,
    refresh: refreshConversations,
    rename: renameConversation,
    setPinned: setConversationPinned,
    remove: removeConversation,
    exportAsMarkdown: exportConversation,
  } = useConversations();
  const modeSlotsRef = useRef({
    ask: { conversationId: null, messages: INITIAL_MESSAGES },
    compliance: { conversationId: null, messages: INITIAL_MESSAGES },
  });

  useEffect(() => {
    modeSlotsRef.current[mode] = { conversationId, messages };
  }, [mode, conversationId, messages]);

  useEffect(() => {
    // Fires whenever any authenticated request exhausts its one refresh
    // attempt (see httpClient.authFetch) — drops back to the login screen.
    onUnauthorized(() => {
      setUser(null);
      setAuthStatus("unauthenticated");
    });
  }, []);

  useEffect(() => {
    if (!hasTokens()) {
      setAuthStatus("unauthenticated");
      return;
    }
    authFetch("/api/auth/me")
      .then((response) => {
        if (!response.ok) throw new Error(`Auth check returned ${response.status}`);
        return response.json();
      })
      .then((data) => {
        setUser(data);
        setAuthStatus("authenticated");
      })
      .catch(() => {
        clearTokens();
        setAuthStatus("unauthenticated");
      });
  }, []);

  useEffect(() => {
    if (authStatus === "authenticated" && !localStorage.getItem(TOUR_SEEN_STORAGE_KEY)) {
      setIsTourOpen(true);
    }
  }, [authStatus]);

  function handleCloseTour() {
    setIsTourOpen(false);
    localStorage.setItem(TOUR_SEEN_STORAGE_KEY, "true");
  }

  function handleLogout() {
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    clearTokens();
    setUser(null);
    setAuthStatus("unauthenticated");
    if (accessToken && refreshToken) {
      logoutRequest(accessToken, refreshToken).catch((error) => console.error(error));
    }
  }

  function handleModeChange(nextMode) {
    if (nextMode === mode || isStreaming) return;
    const nextSlot = modeSlotsRef.current[nextMode];
    setMode(nextMode);
    setConversationId(nextSlot.conversationId);
    setMessages(nextSlot.messages);
  }

  function handleProviderChange(nextProvider) {
    if (nextProvider === provider || isStreaming) return;
    setProvider(nextProvider);
    localStorage.setItem(PROVIDER_STORAGE_KEY, nextProvider);
  }

  async function handleSelectConversation(id) {
    if (id === conversationId || isStreaming) return;
    try {
      const data = await conversationsApi.getConversation(id);
      // A reopened conversation always lands in the mode it belongs to, so what's
      // shown always matches the active mode toggle.
      setMode(data.kind === "compliance" ? "compliance" : "ask");
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

  async function handleDeleteConversation(id) {
    if (id === conversationId) handleNewChat();
    await removeConversation(id);
  }

  // Typing is never blocked, but sending is: only one response streams at a
  // time, so Send stays inert (per user text stays put, nothing happens)
  // until the current one finishes — no auto-queue, the user sends again
  // themselves when they're ready.
  async function handleSend(text) {
    if (isStreaming) return;

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
      followUpQuestions: [],
      error: null,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    function updateAssistantMessage(updater) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId ? updater(message) : message
        )
      );
    }

    await sendMessage(text, conversationId, provider, {
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
      onFollowUps: (questions) => {
        updateAssistantMessage((message) => ({ ...message, followUpQuestions: questions }));
      },
      onError: (detail) => {
        console.error(detail);
        updateAssistantMessage((message) => ({
          ...message,
          error: !message.content ? detail || "Sorry, something went wrong reaching the backend." : null,
          isStreaming: false,
        }));
      },
    });
  }

  function handleSelectFollowUp(question) {
    handleSend(question);
  }

  async function handleComplianceCheck(description) {
    if (isStreaming) return;

    const userMessage = { id: `user_${Date.now()}`, role: "user", content: description };
    const assistantMessageId = `assistant_${Date.now()}`;
    const assistantMessage = {
      id: assistantMessageId,
      serverId: null,
      role: "assistant",
      type: "compliance_report",
      content: "",
      checklist: [],
      sources: [],
      feedback: null,
      versions: [],
      activeVersionIndex: 0,
      isStreaming: true,
      followUpQuestions: [],
      error: null,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    function updateAssistantMessage(updater) {
      setMessages((prev) =>
        prev.map((message) => (message.id === assistantMessageId ? updater(message) : message))
      );
    }

    await runComplianceCheck(description, conversationId, provider, {
      onItem: (item) => {
        updateAssistantMessage((message) => ({
          ...message,
          checklist: [...message.checklist, item],
        }));
      },
      onDone: ({ conversation_id, message_id }) => {
        setConversationId(conversation_id);
        updateAssistantMessage((message) => ({
          ...message,
          serverId: message_id,
          isStreaming: false,
          content: checklistToMarkdown(message.checklist),
          versions: [{ content: checklistToMarkdown(message.checklist), sources: [] }],
          activeVersionIndex: 0,
        }));
        refreshConversations();
      },
      onError: (detail) => {
        console.error(detail);
        updateAssistantMessage((message) => ({
          ...message,
          error: detail || "Sorry, something went wrong reaching the backend.",
          isStreaming: false,
        }));
      },
    });
  }

  function handleStopGenerating() {
    cancelStream();
    // Aborting the fetch fires neither onDone nor onError, so the in-flight message
    // would otherwise stay stuck showing the streaming/pending state forever.
    setMessages((prev) =>
      prev.map((message) => (message.isStreaming ? { ...message, isStreaming: false } : message))
    );
  }

  async function handleFeedback(clientMessageId, feedback, feedbackReason, feedbackComment) {
    const message = messages.find((item) => item.id === clientMessageId);
    if (!message?.serverId || !conversationId) return;

    setMessages((prev) =>
      prev.map((item) =>
        item.id === clientMessageId ? { ...item, feedback } : item
      )
    );

    try {
      await conversationsApi.setMessageFeedback(
        conversationId,
        message.serverId,
        feedback,
        feedbackReason,
        feedbackComment
      );
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
    updateMessage((item) => ({
      ...item,
      content: "",
      isStreaming: true,
      followUpQuestions: [],
      error: null,
    }));

    await regenerateMessage(conversationId, message.serverId, provider, {
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
      onFollowUps: (questions) => {
        updateMessage((item) => ({ ...item, followUpQuestions: questions }));
      },
      onError: (detail) => {
        console.error(detail);
        updateMessage((item) => ({
          ...item,
          error: detail || "Sorry, something went wrong reaching the backend.",
          isStreaming: false,
        }));
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
      await conversationsApi.setActiveMessageVersion(conversationId, message.serverId, targetIndex);
    } catch (error) {
      console.error(error);
    }
  }

  if (authStatus === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    return <LoginScreen />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <ConversationSidebar
        conversations={conversations}
        activeConversationId={conversationId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        onRename={renameConversation}
        onDelete={handleDeleteConversation}
        onPin={setConversationPinned}
        onExport={exportConversation}
        isLoading={isLoadingConversations}
        provider={provider}
        onProviderChange={handleProviderChange}
        isStreaming={isStreaming}
        user={user}
        onLogout={handleLogout}
        onStartTour={() => setIsTourOpen(true)}
      />
      {isTourOpen && <GuidedTour onClose={handleCloseTour} />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <ChatViewport
          messages={messages}
          mode={mode}
          onFeedback={handleFeedback}
          onRegenerate={handleRegenerate}
          onSwitchVersion={handleSwitchVersion}
          onSelectFollowUp={handleSelectFollowUp}
          isRequestInFlight={isStreaming}
        />
        <ChatInput
          mode={mode}
          onModeChange={handleModeChange}
          onSend={handleSend}
          onComplianceCheck={handleComplianceCheck}
          disabled={isStreaming}
          isStreaming={isStreaming}
          onStop={handleStopGenerating}
        />
      </div>
    </div>
  );
}

export default App;
