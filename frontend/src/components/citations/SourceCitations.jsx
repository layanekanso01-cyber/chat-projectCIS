import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

function CopyPassageButton({ quote }) {
  const [isCopied, setIsCopied] = useState(false);

  async function handleCopy(event) {
    event.stopPropagation();
    await navigator.clipboard.writeText(quote || "");
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  }

  return (
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
  );
}

/**
 * Collapsible metadata accordion shown below an assistant message when "Show sources"
 * is toggled on — one row per source, expanding to reveal the document, control/safeguard
 * label, and quoted passage. `highlightedIndex`/`highlightSignal` let an inline [n]
 * citation click (see MessageBubble) force that specific row open and scroll it into
 * view even if the panel was just opened.
 */
export function SourceCitations({ sources, visible, highlightedIndex, highlightSignal }) {
  const [openValues, setOpenValues] = useState([]);
  const itemRefs = useRef({});
  const seenSignalRef = useRef(0);

  useEffect(() => {
    if (highlightSignal > 0 && highlightSignal !== seenSignalRef.current && highlightedIndex) {
      seenSignalRef.current = highlightSignal;
      const value = String(highlightedIndex);
      setOpenValues((prev) => (prev.includes(value) ? prev : [...prev, value]));
      requestAnimationFrame(() => {
        itemRefs.current[value]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }, [highlightSignal, highlightedIndex]);

  if (!sources || sources.length === 0 || !visible) return null;

  return (
    <div className="mt-2 border-t border-border pt-2">
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        Sources
      </span>
      <Accordion
        value={openValues}
        onValueChange={setOpenValues}
        className="mt-1.5 overflow-hidden rounded-lg border border-border"
      >
        {sources.map((source, i) => {
          const index = i + 1;
          const value = String(index);
          const isHighlighted = highlightedIndex === index;
          return (
            <div
              key={`${source.source}-${source.chunk_id}-${index}`}
              ref={(el) => {
                itemRefs.current[value] = el;
              }}
              className={`transition-colors ${isHighlighted ? "bg-primary/5" : "bg-card"}`}
            >
              <AccordionItem value={value} className="not-last:border-b not-last:border-border px-2.5">
                <AccordionTrigger className="gap-2 py-1.5 text-xs hover:no-underline">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-[10px] font-medium text-primary">
                    {index}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {source.source || "CIS Controls v8"}
                    {source.control_label && (
                      <span className="text-muted-foreground"> · {source.control_label}</span>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-xs text-muted-foreground italic">"{source.quote}"</p>
                  <CopyPassageButton quote={source.quote} />
                </AccordionContent>
              </AccordionItem>
            </div>
          );
        })}
      </Accordion>
    </div>
  );
}
