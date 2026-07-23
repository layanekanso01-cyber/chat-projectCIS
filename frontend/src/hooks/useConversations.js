import { useCallback, useEffect, useState } from "react";
import * as conversationsApi from "@/api/conversations";
import { conversationToMarkdown, downloadTextFile, slugify } from "@/lib/utils";

/**
 * Owns the sidebar conversation list and every CRUD operation on it (rename, pin,
 * delete, export). Deliberately does not know about "the currently open conversation" —
 * that's app-level orchestration (switching mode, resetting the view on delete), so it
 * stays in App.jsx and composes with what this hook exposes.
 */
export function useConversations() {
  const [conversations, setConversations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setConversations(await conversationsApi.listConversations());
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount: `refresh` legitimately calls setState (loading flag +
    // the fetched list). eslint-plugin-react-hooks' newer set-state-in-effect rule
    // flags any setState reachable from an effect, but this is exactly the documented
    // "synchronize with an external system" use case for effects, not the derived-state
    // anti-pattern the rule exists to catch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function rename(id, title) {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.conversation_id === id ? { ...conversation, title } : conversation
      )
    );
    try {
      await conversationsApi.renameConversation(id, title);
    } catch (error) {
      console.error(error);
      refresh();
    }
  }

  async function setPinned(id, pinned) {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.conversation_id === id ? { ...conversation, pinned } : conversation
      )
    );
    try {
      await conversationsApi.setConversationPinned(id, pinned);
    } catch (error) {
      console.error(error);
      refresh();
    }
  }

  async function remove(id) {
    setConversations((prev) => prev.filter((conversation) => conversation.conversation_id !== id));
    try {
      await conversationsApi.deleteConversation(id);
    } catch (error) {
      console.error(error);
      refresh();
    }
  }

  async function exportAsMarkdown(id) {
    try {
      const data = await conversationsApi.getConversation(id);
      downloadTextFile(`${slugify(data.title || "conversation")}.md`, conversationToMarkdown(data));
    } catch (error) {
      console.error(error);
    }
  }

  return { conversations, isLoading, refresh, rename, setPinned, remove, exportAsMarkdown };
}
