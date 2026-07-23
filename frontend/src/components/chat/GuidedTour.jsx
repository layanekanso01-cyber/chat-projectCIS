import { useLayoutEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const CALLOUT_WIDTH = 280;
const GAP = 12;
const PADDING = 4;

export const TOUR_STEPS = [
  {
    target: "new-chat",
    title: "Start a new chat",
    description: "This always starts a fresh conversation, separate from whatever you're viewing now.",
  },
  {
    target: "mode-toggle",
    title: "Ask vs. Compliance Check",
    description:
      "\"Ask\" is normal Q&A against the CIS Controls. \"Compliance Check\" judges a pasted security setup against all 18 controls at once.",
  },
  {
    target: "chat-input",
    title: "Type your question here",
    description: "Press Enter to send, Shift+Enter for a new line. You can stop a response mid-stream too.",
  },
  {
    target: "provider-toggle",
    title: "Choose your model",
    description: "Switch between Ollama (local) and Gemini for generation — this applies to every new message.",
  },
  {
    target: "account-menu",
    title: "Your account",
    description: "Sign out from here. Admin accounts also get an audit log of every request the middleware has handled.",
  },
];

function computeRects(targetName) {
  const el = document.querySelector(`[data-tour="${targetName}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();

  const spaceBelow = window.innerHeight - rect.bottom;
  const placeBelow = spaceBelow > 160 || spaceBelow > rect.top;

  const rawLeft = rect.left + rect.width / 2 - CALLOUT_WIDTH / 2;
  const left = Math.min(
    Math.max(rawLeft, GAP),
    window.innerWidth - CALLOUT_WIDTH - GAP
  );
  const top = placeBelow ? rect.bottom + GAP : undefined;
  const bottom = placeBelow ? undefined : window.innerHeight - rect.top + GAP;

  return { rect, left, top, bottom };
}

export function GuidedTour({ onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [positions, setPositions] = useState(null);

  const step = TOUR_STEPS[stepIndex];
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  useLayoutEffect(() => {
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });

    // A short delay lets the scroll (and sidebar/collapse transitions, if any)
    // settle before measuring — measuring mid-scroll would place the callout
    // at a stale position.
    const timeout = setTimeout(() => setPositions(computeRects(step.target)), 120);

    function recompute() {
      setPositions(computeRects(step.target));
    }
    window.addEventListener("resize", recompute);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("resize", recompute);
    };
  }, [step.target]);

  if (!positions) return null;
  const { rect } = positions;

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute rounded-lg transition-all duration-200"
        style={{
          top: rect.top - PADDING,
          left: rect.left - PADDING,
          width: rect.width + PADDING * 2,
          height: rect.height + PADDING * 2,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
        }}
      />
      <div
        className="absolute w-[280px] rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-lg"
        style={{ left: positions.left, top: positions.top, bottom: positions.bottom }}
      >
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{step.title}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Skip tour"
            className="-mt-0.5 -mr-0.5 shrink-0"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{step.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {stepIndex + 1} of {TOUR_STEPS.length}
          </span>
          <div className="flex gap-1.5">
            {stepIndex > 0 && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setStepIndex((i) => i - 1)}
              >
                Back
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              onClick={() => (isLast ? onClose() : setStepIndex((i) => i + 1))}
            >
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
