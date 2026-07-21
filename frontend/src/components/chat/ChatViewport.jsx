import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";

const BOTTOM_THRESHOLD_PX = 48;

export function ChatViewport({ messages, onFeedback, onRegenerate, onSwitchVersion }) {
  const containerRef = useRef(null);
  const prevLengthRef = useRef(messages.length);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsPinnedToBottom(distanceFromBottom <= BOTTOM_THRESHOLD_PX);
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // A newly appended message (the user sending one) always pulls the
    // viewport back to bottom, even if they'd scrolled up to read history.
    const hasNewMessage = messages.length > prevLengthRef.current;
    prevLengthRef.current = messages.length;

    if (isPinnedToBottom || hasNewMessage) {
      el.scrollTop = el.scrollHeight;
      if (hasNewMessage) setIsPinnedToBottom(true);
    }
  }, [messages, isPinnedToBottom]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-6"
    >
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          role={message.role}
          content={message.content}
          isStreaming={message.isStreaming}
          sources={message.sources}
          serverId={message.serverId}
          feedback={message.feedback}
          onFeedback={(feedback, feedbackReason) =>
            onFeedback?.(message.id, feedback, feedbackReason)
          }
          versions={message.versions}
          activeVersionIndex={message.activeVersionIndex}
          onRegenerate={() => onRegenerate?.(message.id)}
          onSwitchVersion={(index) => onSwitchVersion?.(message.id, index)}
        />
      ))}
    </div>
  );
}
