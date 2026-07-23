import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

function SourceCard({ source, index, isHighlighted, forceOpenSignal }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [seenSignal, setSeenSignal] = useState(0);
  const cardRef = useRef(null);

  // Adjust state during render (React's documented pattern for syncing state to a prop
  // change) instead of calling setState inside an effect, which triggers an extra
  // cascading render for no benefit here.
  if (forceOpenSignal > 0 && forceOpenSignal !== seenSignal) {
    setSeenSignal(forceOpenSignal);
    setIsOpen(true);
  }

  useEffect(() => {
    if (forceOpenSignal > 0) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [forceOpenSignal]);

  async function handleCopy(event) {
    event.stopPropagation();
    await navigator.clipboard.writeText(source.quote || "");
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  }

  return (
    <div
      ref={cardRef}
      className={`overflow-hidden rounded-lg border transition-colors ${
        isHighlighted ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-[10px] font-medium text-primary">
          {index}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
          {source.source || "CIS Controls v8"}
          {source.control_label && (
            <span className="text-muted-foreground"> · {source.control_label}</span>
          )}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      {isOpen && (
        <div className="border-t border-border px-2.5 py-2">
          <p className="text-xs text-muted-foreground italic">"{source.quote}"</p>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleCopy}
            className="mt-1.5 h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
          >
            {isCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {isCopied ? "Copied" : "Copy passage"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Expandable source list shown below an assistant message when "Show sources" is
 * toggled on. `highlightedIndex`/`highlightSignal` let an inline [n] citation click
 * (see MessageBubble) force that specific card open and scroll it into view even if
 * the panel was just opened.
 */
export function SourceCitations({ sources, visible, highlightedIndex, highlightSignal }) {
  if (!sources || sources.length === 0 || !visible) return null;

  return (
    <div className="mt-2 border-t border-border pt-2">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Sources
      </span>
      <div className="mt-1.5 space-y-1">
        {sources.map((source, i) => {
          const index = i + 1;
          return (
            <SourceCard
              key={`${source.source}-${source.chunk_id}-${index}`}
              source={source}
              index={index}
              isHighlighted={highlightedIndex === index}
              forceOpenSignal={highlightedIndex === index ? highlightSignal : 0}
            />
          );
        })}
      </div>
    </div>
  );
}
