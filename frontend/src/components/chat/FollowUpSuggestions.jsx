export function FollowUpSuggestions({ questions, onSelect }) {
  if (!questions || questions.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onSelect(question)}
          className="rounded-full border border-border bg-background px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
        >
          {question}
        </button>
      ))}
    </div>
  );
}
