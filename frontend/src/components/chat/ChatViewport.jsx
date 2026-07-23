import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { MessageBubble } from "./MessageBubble";
import { EmptyState } from "./EmptyState";

const BOTTOM_THRESHOLD_PX = 48;

export function ChatViewport({
  messages,
  mode = "ask",
  onFeedback,
  onRegenerate,
  onSwitchVersion,
  onSelectFollowUp,
  isRequestInFlight = false,
}) {
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

  function scrollToBottom() {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setIsPinnedToBottom(true);
  }

  if (messages.length === 1 && messages[0].id === "welcome") {
    return (
      <div className="relative flex-1 overflow-hidden">
        <EmptyState mode={mode} onSelectQuestion={onSelectFollowUp} />
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-6"
      >
        <div className="mx-auto w-full max-w-[800px]">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={message.content}
              type={message.type}
              checklist={message.checklist}
              isStreaming={message.isStreaming}
              sources={message.sources}
              serverId={message.serverId}
              feedback={message.feedback}
              onFeedback={(feedback, feedbackReason, feedbackComment) =>
                onFeedback?.(message.id, feedback, feedbackReason, feedbackComment)
              }
              versions={message.versions}
              activeVersionIndex={message.activeVersionIndex}
              onRegenerate={() => onRegenerate?.(message.id)}
              onSwitchVersion={(index) => onSwitchVersion?.(message.id, index)}
              followUpQuestions={message.followUpQuestions}
              error={message.error}
              onSelectFollowUp={onSelectFollowUp}
              isRequestInFlight={isRequestInFlight}
            />
          ))}
        </div>
      </div>
      {!isPinnedToBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          className="absolute bottom-4 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md hover:bg-muted"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
