import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { fetchInsights } from "@/api/admin";

function StatTile({ label, value, tone }) {
  const toneClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-500"
      : tone === "bad"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function Section({ title, description, children }) {
  return (
    <div className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-medium text-foreground">{title}</h3>
      {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function UsageChart({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="flex h-24 gap-[3px]">
      {data.map((day) => {
        const heightPct = day.count === 0 ? 2 : Math.max((day.count / max) * 100, 6);
        return (
          <Tooltip key={day.date}>
            <TooltipTrigger
              render={<div className="flex h-full flex-1 flex-col items-center justify-end" />}
            >
              <div
                className="w-full rounded-t-sm bg-primary/70"
                style={{ height: `${heightPct}%` }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {day.date}: {day.count} request{day.count === 1 ? "" : "s"}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function RankedList({ items, renderLabel, emptyText }) {
  if (!items || items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-2 text-xs">
          <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
            {item.count}×
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground">{renderLabel(item)}</span>
        </li>
      ))}
    </ul>
  );
}

export function InsightsDialog({ open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setError(null);
    fetchInsights()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Insights</DialogTitle>
          <DialogDescription>How the assistant is actually being used.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {data && (
            <>
              <Section title="Feedback">
                <div className="grid grid-cols-3 gap-2">
                  <StatTile label="Thumbs up" value={data.feedback.up} tone="good" />
                  <StatTile label="Thumbs down" value={data.feedback.down} tone="bad" />
                  <StatTile label="No feedback" value={data.feedback.noFeedback} />
                </div>
                {data.topDownvoteReasons.length > 0 && (
                  <div className="mt-2">
                    <RankedList
                      items={data.topDownvoteReasons}
                      renderLabel={(r) => r.reason}
                      emptyText="No downvote reasons yet."
                    />
                  </div>
                )}
              </Section>

              <Section
                title="Retrieval gaps"
                description="Recent answers where the model said it didn't have the information — the most direct signal of a real content/ingestion gap."
              >
                {data.retrievalGaps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None in recent activity.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.retrievalGaps.slice(0, 8).map((gap) => (
                      <li key={gap.messageId} className="rounded-lg border border-border bg-card px-2.5 py-2">
                        <p className="text-xs font-medium text-foreground">
                          {gap.question || "(no question captured)"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground italic">
                          "{gap.answerSnippet}"
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Most-asked questions">
                <RankedList
                  items={data.mostAskedQuestions}
                  renderLabel={(q) => q.question}
                  emptyText="No questions yet."
                />
              </Section>

              <Section title="Usage, last 14 days" description="Requests handled by the middleware, per day.">
                <UsageChart data={data.usageByDay} />
              </Section>

              <Section
                title="Provider split"
                description={
                  data.providerSplit.length === 0
                    ? "No data yet — provider tracking started with this feature, so only new messages are counted."
                    : undefined
                }
              >
                {data.providerSplit.length === 0 ? null : (
                  <div className="flex gap-2">
                    {data.providerSplit.map((p) => (
                      <StatTile key={p.provider} label={p.provider} value={p.count} />
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
