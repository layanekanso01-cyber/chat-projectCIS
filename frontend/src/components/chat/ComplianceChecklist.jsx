const TOTAL_CONTROLS = 18;

const STATUS_STYLES = {
  Covered: "border-relevance-high/30 bg-relevance-high/10 text-relevance-high",
  Partial: "border-relevance-medium/30 bg-relevance-medium/10 text-relevance-medium",
  Gap: "border-destructive/30 bg-destructive/10 text-destructive",
  Unclear: "border-border bg-muted text-muted-foreground",
};

export function ComplianceChecklist({ checklist = [], isStreaming = false }) {
  const isChecking = isStreaming && checklist.length < TOTAL_CONTROLS;

  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        Checked {checklist.length} of {TOTAL_CONTROLS} Controls{isChecking ? "..." : "."}
      </p>
      <div className="space-y-2">
        {checklist.map((item) => (
          <div key={item.control_number} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                Control {item.control_number}: {item.control_title}
              </span>
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  STATUS_STYLES[item.status] || STATUS_STYLES.Unclear
                }`}
              >
                {item.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
          </div>
        ))}
        {isChecking && (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </span>
            Checking Control {checklist.length + 1}...
          </div>
        )}
      </div>
    </div>
  );
}
