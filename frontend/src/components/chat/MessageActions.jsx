import { useState } from "react";
import {
  Copy,
  Check,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Quote,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackButtons } from "@/components/feedback/FeedbackButtons";
import { downloadTextFile, sourcesToMarkdown } from "@/lib/utils";

function CopyButton({ content }) {
  const [isCopied, setIsCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Copy message"
      onClick={handleCopy}
      className="text-muted-foreground"
    >
      {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function ExportButton({ content, sources }) {
  function handleExport() {
    const markdown = content.trim() + sourcesToMarkdown(sources);
    downloadTextFile(`cis-answer-${Date.now()}.md`, markdown);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Export answer"
      onClick={handleExport}
      className="text-muted-foreground"
    >
      <Download className="size-3.5" />
    </Button>
  );
}

/**
 * Hover-revealed action row below a message: copy (any role), plus
 * regenerate/feedback/show-sources/export/version-switching for assistant messages only.
 */
export function MessageActions({
  content,
  sources = [],
  isAssistant,
  feedback,
  onFeedback,
  onRegenerate,
  hasMultipleVersions,
  activeVersionIndex,
  totalVersions,
  onSwitchVersion,
  sourcesVisible,
  onToggleSources,
  showRegenerate = true,
  showFeedback = true,
}) {
  return (
    <div className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100">
      <CopyButton content={content} />
      {isAssistant && (
        <>
          {showFeedback && <FeedbackButtons feedback={feedback} onFeedback={onFeedback} />}
          {showRegenerate && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Regenerate response"
              onClick={onRegenerate}
              className="text-muted-foreground"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          )}
          {onToggleSources && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={sourcesVisible ? "Hide sources" : "Show sources"}
              aria-pressed={sourcesVisible}
              onClick={onToggleSources}
              className={sourcesVisible ? "text-primary" : "text-muted-foreground"}
            >
              <Quote className="size-3.5" />
            </Button>
          )}
          <ExportButton content={content} sources={sources} />
          {hasMultipleVersions && (
            <div className="ml-1 flex items-center gap-0.5 text-[10px] text-muted-foreground">
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
                {activeVersionIndex + 1}/{totalVersions}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Next version"
                disabled={activeVersionIndex === totalVersions - 1}
                onClick={() => onSwitchVersion(activeVersionIndex + 1)}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
