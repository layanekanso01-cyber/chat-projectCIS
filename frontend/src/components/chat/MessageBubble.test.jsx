import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBubble } from "./MessageBubble";

const SOURCES = [
  { source: "Control 1", quote: "Actively manage all enterprise assets." },
  { source: "Safeguard 1.5", quote: "Use a passive asset discovery tool." },
];

describe("MessageBubble citation linking", () => {
  it("renders a single bracket citation as one clickable badge", () => {
    render(
      <MessageBubble
        role="assistant"
        content="Assets must be inventoried [1]."
        sources={SOURCES}
        serverId="msg-1"
      />
    );
    expect(screen.getByRole("button", { name: "Jump to source 1" })).toBeEnabled();
  });

  it("splits a combined bracket like '[1, 2]' into two separate clickable badges", () => {
    // Regression test: the model sometimes emits "[1, 2]" instead of "[1][2]". The old
    // regex only matched a single number per bracket, so this fell through unlinkified
    // and rendered as dead literal text with no citation badge at all.
    render(
      <MessageBubble
        role="assistant"
        content="Control 01 is Inventory and Control of Enterprise Assets [1, 2]."
        sources={SOURCES}
        serverId="msg-2"
      />
    );
    expect(screen.getByRole("button", { name: "Jump to source 1" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Jump to source 2" })).toBeEnabled();
    expect(screen.queryByText("[1, 2]", { exact: false })).not.toBeInTheDocument();
  });

  it("renders an out-of-range citation number as a disabled badge, not a crash", () => {
    render(
      <MessageBubble
        role="assistant"
        content="This cites a source that doesn't exist [9]."
        sources={SOURCES}
        serverId="msg-3"
      />
    );
    expect(screen.getByRole("button", { name: "Jump to source 9" })).toBeDisabled();
  });
});
