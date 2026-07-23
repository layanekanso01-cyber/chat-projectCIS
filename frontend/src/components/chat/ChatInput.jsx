import { useRef, useState } from "react";
import { ArrowUp, Square, MessageCircle, ClipboardCheck } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const MAX_TEXTAREA_HEIGHT_PX = 200;
const COMPLIANCE_DESCRIPTION_MAX_CHARS = 4000;

const MODE_CONFIG = {
  ask: {
    label: "Ask",
    icon: MessageCircle,
    placeholder: "Message the CIS Controls assistant...",
  },
  compliance: {
    label: "Compliance Check",
    icon: ClipboardCheck,
    placeholder: "Paste a description of your current security setup...",
  },
};

export function ChatInput({
  mode,
  onModeChange,
  onSend,
  onComplianceCheck,
  disabled = false,
  isStreaming = false,
  onStop,
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef(null);

  function resizeTextarea(el) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }

  function handleChange(event) {
    setValue(event.target.value);
    resizeTextarea(event.target);
  }

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    if (mode === "compliance") onComplianceCheck(trimmed);
    else onSend(trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  }

  return (
    <div className="px-4 pt-2 pb-6">
      <div className="mx-auto mb-1.5 flex w-full max-w-[800px] items-center gap-1.5">
        {Object.entries(MODE_CONFIG).map(([key, config]) => {
          const Icon = config.icon;
          return (
            <Button
              key={key}
              type="button"
              variant={mode === key ? "secondary" : "ghost"}
              size="xs"
              disabled={disabled}
              onClick={() => onModeChange(key)}
              className="gap-1"
            >
              <Icon className="size-3" />
              {config.label}
            </Button>
          );
        })}
      </div>
      {mode === "compliance" && (
        <p className="mx-auto mb-1.5 max-w-[800px] text-xs text-muted-foreground">
          Judged against all 18 CIS Controls, one at a time — this takes a couple of minutes.
        </p>
      )}
      <form
        onSubmit={handleSubmit}
        className="mx-auto flex w-full max-w-[800px] items-end gap-2 rounded-3xl border border-border bg-background p-2 shadow-sm"
      >
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          aria-label={mode === "compliance" ? "Security setup description" : "Chat message"}
          placeholder={MODE_CONFIG[mode].placeholder}
          maxLength={mode === "compliance" ? COMPLIANCE_DESCRIPTION_MAX_CHARS : undefined}
          rows={1}
          className="max-h-[200px] min-h-0 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
        />
        {isStreaming ? (
          <Button
            type="button"
            size="icon"
            onClick={onStop}
            className="mb-0.5 shrink-0 rounded-full"
            aria-label="Stop generating"
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={disabled || !value.trim()}
            className="mb-0.5 shrink-0 rounded-full"
            aria-label="Send message"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </form>
      <p className="mx-auto mt-2 max-w-[800px] text-center text-xs text-muted-foreground">
        AI-generated answers may be inaccurate. Verify against the source document.
      </p>
    </div>
  );
}
