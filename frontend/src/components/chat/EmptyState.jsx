import { ShieldCheck, ClipboardCheck } from "lucide-react";

const STARTER_QUESTIONS = [
  "What are the CIS Controls?",
  "Explain Control 3.",
  "How should software assets be managed?",
];

function AskEmptyState({ onSelectQuestion }) {
  return (
    <>
      <div className="relative flex size-12 items-center justify-center rounded-2xl bg-primary/10">
        <ShieldCheck className="size-6 text-primary" />
      </div>
      <div>
        <h1 className="text-lg font-medium text-foreground">CIS Controls v8 Assistant</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask me a question about the CIS Controls v8 document.
        </p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-2">
        {STARTER_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onSelectQuestion(question)}
            className="rounded-xl border border-border bg-background px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
          >
            {question}
          </button>
        ))}
      </div>
    </>
  );
}

function ComplianceEmptyState() {
  return (
    <>
      <div className="relative flex size-12 items-center justify-center rounded-2xl bg-primary/10">
        <ClipboardCheck className="size-6 text-primary" />
      </div>
      <div>
        <h1 className="text-lg font-medium text-foreground">Compliance Check</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Paste a description of your current security setup below, and it'll be judged
          against all 18 CIS Controls — one at a time, flagging likely gaps.
        </p>
      </div>
      <div className="w-full max-w-md rounded-xl border border-dashed border-border px-4 py-3 text-left text-xs text-muted-foreground">
        Mention what you actually have in place: asset inventory, antivirus, patching,
        account management, MFA, backups, network segmentation, incident response — the
        more specific, the more accurate the results.
      </div>
    </>
  );
}

export function EmptyState({ mode = "ask", onSelectQuestion }) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="security-wallpaper" aria-hidden="true" />
      {mode === "compliance" ? (
        <ComplianceEmptyState />
      ) : (
        <AskEmptyState onSelectQuestion={onSelectQuestion} />
      )}
    </div>
  );
}
