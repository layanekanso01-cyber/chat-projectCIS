import { useCallback, useRef, useState } from "react";
import { RAG_API_PREFIX } from "@/lib/config";
import { authFetch } from "@/api/httpClient";

function parseSSEFrame(frame) {
  let event = "message";
  const dataLines = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  return { event, data: dataLines.join("\n") };
}

/**
 * Streams a POST endpoint that responds with SSE frames and dispatches them
 * to callbacks. Uses fetch + a manual reader (not EventSource) since the
 * request needs a JSON POST body, which EventSource cannot send.
 */
export function useChatStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef(null);

  const streamRequest = useCallback(
    async (path, body, { onSources, onToken, onDone, onFollowUps, onItem, onError }) => {
      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await authFetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Backend returned ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop();

          for (const frame of frames) {
            if (!frame.trim()) continue;
            const { event, data } = parseSSEFrame(frame);
            if (!data) continue;

            const payload = JSON.parse(data);
            if (event === "sources") onSources?.(payload.sources);
            else if (event === "token") onToken?.(payload.text);
            else if (event === "done") onDone?.(payload);
            else if (event === "follow_ups") onFollowUps?.(payload.questions);
            else if (event === "item") onItem?.(payload);
            else if (event === "error") onError?.(payload.detail);
          }
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          onError?.(error.message);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    []
  );

  const sendMessage = useCallback(
    (question, conversationId, provider, callbacks) =>
      streamRequest(
        `${RAG_API_PREFIX}/chat/stream`,
        { question, conversation_id: conversationId, provider },
        callbacks
      ),
    [streamRequest]
  );

  const regenerateMessage = useCallback(
    (conversationId, messageId, provider, callbacks) =>
      streamRequest(
        `${RAG_API_PREFIX}/conversations/${conversationId}/messages/${messageId}/regenerate`,
        { provider },
        callbacks
      ),
    [streamRequest]
  );

  const runComplianceCheck = useCallback(
    (description, conversationId, provider, callbacks) =>
      streamRequest(
        `${RAG_API_PREFIX}/compliance-check/stream`,
        { description, conversation_id: conversationId, provider },
        callbacks
      ),
    [streamRequest]
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { sendMessage, regenerateMessage, runComplianceCheck, isStreaming, cancelStream };
}
