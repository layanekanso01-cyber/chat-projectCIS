import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SourceCitations } from "@/components/citations/SourceCitations";
import { MessageActions } from "./MessageActions";
import { FollowUpSuggestions } from "./FollowUpSuggestions";
import { ComplianceChecklist } from "./ComplianceChecklist";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

// Turns literal "[1]", "[2]", ... in the model's answer into markdown links pointing
// at a fake "#cite-N" href, which the custom `a` renderer below turns into a clickable
// citation badge instead of a real navigating link. `(?!\()` skips anything that's
// already a real markdown link target, e.g. "[text](url)".
function linkifyCitations(text) {
  return text.replace(/\[(\d{1,2})\](?!\()/g, "[$1](#cite-$1)");
}

const CITATION_BADGE_CLASS =
  "mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded-full border border-primary/30 bg-primary/10 px-1 align-super text-[10px] font-medium text-primary outline-none transition-colors hover:bg-primary/20 disabled:opacity-40";

function truncateSnippet(text, maxLength = 160) {
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

function CitationLink({ href, children, sources, onCiteClick }) {
  const match = /^#cite-(\d+)$/.exec(href || "");
  if (!match) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:opacity-80"
      >
        {children}
      </a>
    );
  }

  const index = Number(match[1]);
  const source = Boolean(sources) && index >= 1 && index <= sources.length ? sources[index - 1] : null;

  function handleClick(event) {
    event.preventDefault();
    if (source) onCiteClick(index);
  }

  if (!source) {
    return (
      <button type="button" disabled aria-label={`Jump to source ${index}`} className={CITATION_BADGE_CLASS}>
        {index}
      </button>
    );
  }

  // Hovering previews the snippet inline; clicking still jumps to the full source
  // card below (scrolled into view + expanded) for the passage, control label, etc.
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={handleClick}
            aria-label={`Jump to source ${index}`}
            className={CITATION_BADGE_CLASS}
          />
        }
      >
        {index}
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">
          {truncateSnippet(source.quote) || source.source || "View source"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

const baseMarkdownComponents = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ inline, children }) =>
    inline ? (
      <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-xs">
        {children}
      </code>
    ) : (
      <code className="font-mono text-xs">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-xl border border-border bg-muted p-3 font-mono last:mb-0">
      {children}
    </pre>
  ),
};

function ThinkingDots({ label }) {
  return (
    <span className="flex items-center gap-2 py-1">
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
      </span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  );
}

export function MessageBubble({
  role,
  content,
  type = "text",
  checklist = [],
  isStreaming = false,
  loadingLabel = null,
  sources = [],
  serverId = null,
  feedback = null,
  onFeedback,
  versions = [],
  activeVersionIndex = 0,
  onRegenerate,
  onSwitchVersion,
  followUpQuestions = [],
  onSelectFollowUp,
  error = null,
  isRequestInFlight = false,
}) {
  const isUser = role === "user";
  const isComplianceReport = type === "compliance_report";
  const isPending = !isUser && isStreaming && !isComplianceReport && content.length === 0;
  const isCompliancePending = isComplianceReport && isStreaming && checklist.length === 0;
  const canShowActions = !isStreaming && !!serverId;
  // This message's own stream can finish (isStreaming above goes false, e.g. once the
  // "done" event lands) a few seconds before the underlying fetch itself actually closes
  // — it stays open a little longer to deliver trailing follow-up-question data. Actions
  // that start a *new* request (regenerate) are gated on that fetch having fully closed,
  // not just on this message looking finished, or a click in that window would silently
  // no-op: the button looked ready but the app's global "one stream at a time" guard
  // would still reject it.
  const canRegenerate = canShowActions && !isRequestInFlight;
  const hasMultipleVersions = versions.length > 1;

  const [sourcesVisible, setSourcesVisible] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(null);
  const [highlightSignal, setHighlightSignal] = useState(0);

  function handleCiteClick(index) {
    setSourcesVisible(true);
    setHighlightedIndex(index);
    setHighlightSignal((prev) => prev + 1);
  }

  const markdownComponents = useMemo(
    () => ({
      ...baseMarkdownComponents,
      a: (props) => <CitationLink {...props} sources={sources} onCiteClick={handleCiteClick} />,
    }),
    [sources]
  );

  const showFollowUps = !isUser && !isStreaming && followUpQuestions.length > 0 && !!onSelectFollowUp;

  return (
    <div
      className={`group/message flex ${isUser ? "mb-2 justify-end" : "mb-8 justify-start"}`}
    >
      <div className={`max-w-[80%] ${isUser ? "" : "w-full"}`}>
        <div
          className={
            isUser
              ? "rounded-xl bg-muted px-4 py-2.5 text-sm text-foreground"
              : "text-sm text-foreground"
          }
        >
          {isUser ? (
            content
          ) : isComplianceReport ? (
            isCompliancePending ? (
              <ThinkingDots label="Checking against CIS Controls..." />
            ) : (
              <ComplianceChecklist checklist={checklist} isStreaming={isStreaming} />
            )
          ) : isPending ? (
            <ThinkingDots label={loadingLabel} />
          ) : (
            <>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {linkifyCitations(content)}
              </ReactMarkdown>
              <SourceCitations
                sources={sources}
                visible={sourcesVisible}
                highlightedIndex={highlightedIndex}
                highlightSignal={highlightSignal}
              />
            </>
          )}
        </div>

        {error && (
          <p className="mt-1.5 text-sm text-destructive">{error}</p>
        )}

        {canShowActions && (
          <MessageActions
            content={content}
            sources={sources}
            isAssistant={!isUser}
            feedback={feedback}
            onFeedback={onFeedback}
            onRegenerate={onRegenerate}
            hasMultipleVersions={hasMultipleVersions}
            activeVersionIndex={activeVersionIndex}
            totalVersions={versions.length}
            onSwitchVersion={onSwitchVersion}
            sourcesVisible={sourcesVisible}
            onToggleSources={sources.length > 0 ? () => setSourcesVisible((prev) => !prev) : null}
            showRegenerate={!isComplianceReport}
            regenerateDisabled={!canRegenerate}
          />
        )}

        {showFollowUps && (
          <FollowUpSuggestions questions={followUpQuestions} onSelect={onSelectFollowUp} />
        )}
      </div>
    </div>
  );
}
