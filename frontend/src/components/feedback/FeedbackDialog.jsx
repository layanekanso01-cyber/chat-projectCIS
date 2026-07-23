import { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const REASONS = [
  "Not accurate",
  "Not relevant",
  "Missing information",
  "Unclear / confusing",
  "Other",
];

export function FeedbackDialog({ open, onOpenChange, onSubmit }) {
  const [selectedReason, setSelectedReason] = useState(null);
  const [comment, setComment] = useState("");

  function handleSubmit() {
    if (!selectedReason) return;
    onSubmit(selectedReason, comment.trim() || null);
    setSelectedReason(null);
    setComment("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>What went wrong?</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((reason) => (
            <Button
              key={reason}
              type="button"
              size="xs"
              variant={selectedReason === reason ? "default" : "outline"}
              onClick={() => setSelectedReason(reason)}
            >
              {reason}
            </Button>
          ))}
        </div>

        <Textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Additional comments (optional)"
          rows={3}
        />

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" />}>
            Cancel
          </DialogClose>
          <Button size="sm" disabled={!selectedReason} onClick={handleSubmit}>
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
