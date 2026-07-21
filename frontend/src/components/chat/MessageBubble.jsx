import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { SourceCitations } from "@/components/citations/SourceCitations";
import { FeedbackButtons } from "@/components/feedback/FeedbackButtons";
import { Button } from "@/components/ui/button";

const markdownComponents = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-blue-700"
    >
      {children}
    </a>
  ),
  code: ({ inline, children }) =>
    inline ? (
      <code className="rounded bg-gray-200 px-1 py-0.5 font-mono text-xs">
        {children}
      </code>
    ) : (
      <code className="font-mono text-xs">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-gray-800 p-3 text-gray-100 last:mb-0">
      {children}
    </pre>
  ),
};

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1 py-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
    </span>
  );
}

export function MessageBubble({
  role,
  content,
  isStreaming = false,
  sources = [],
  serverId = null,
  feedback = null,
  onFeedback,
  versions = [],
  activeVersionIndex = 0,
  onRegenerate,
  onSwitchVersion,
}) {
  const isUser = role === "user";
  const isPending = !isUser && isStreaming && content.length === 0;
  const canShowActions = !isUser && !isStreaming && !!serverId;
  const hasMultipleVersions = versions.length > 1;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
          isUser ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-900"
        }`}
      >
        {isUser ? (
          content
        ) : isPending ? (
          <ThinkingDots />
        ) : (
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
            <SourceCitations sources={sources} />
            {canShowActions && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <FeedbackButtons feedback={feedback} onFeedback={onFeedback} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Regenerate response"
                    onClick={onRegenerate}
                    className="text-gray-400"
                  >
                    <RefreshCw className="size-3.5" />
                  </Button>
                </div>
                {hasMultipleVersions && (
                  <div className="flex items-center gap-0.5 text-[10px] text-gray-400">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Previous version"
                      disabled={activeVersionIndex === 0}
                      onClick={() => onSwitchVersion(activeVersionIndex - 1)}
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <span>
                      {activeVersionIndex + 1}/{versions.length}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Next version"
                      disabled={activeVersionIndex === versions.length - 1}
                      onClick={() => onSwitchVersion(activeVersionIndex + 1)}
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
