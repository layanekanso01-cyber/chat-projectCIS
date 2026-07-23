import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackDialog } from "./FeedbackDialog";

export function FeedbackButtons({ feedback, onFeedback }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  function handleThumbsUp() {
    // Clicking an already-active thumbs-up clears it.
    onFeedback(feedback === "up" ? null : "up", null);
  }

  function handleThumbsDownSubmit(reasonText) {
    onFeedback("down", reasonText);
    setIsDialogOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Good response"
        aria-pressed={feedback === "up"}
        onClick={handleThumbsUp}
        className={feedback === "up" ? "text-primary" : "text-muted-foreground"}
      >
        <ThumbsUp className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Bad response"
        aria-pressed={feedback === "down"}
        onClick={() => setIsDialogOpen(true)}
        className={feedback === "down" ? "text-primary" : "text-muted-foreground"}
      >
        <ThumbsDown className="size-3.5" />
      </Button>
      <FeedbackDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSubmit={handleThumbsDownSubmit}
      />
    </>
  );
}
