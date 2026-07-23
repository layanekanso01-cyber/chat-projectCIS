import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageActions } from "./MessageActions";

function renderActions(props) {
  return render(
    <TooltipProvider>
      <MessageActions content="An answer." {...props} />
    </TooltipProvider>
  );
}

beforeEach(() => {
  // jsdom doesn't implement these — ExportButton's download path touches both.
  URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
  URL.revokeObjectURL = vi.fn();
});

describe("MessageActions", () => {
  it("shows only Copy for a user message", () => {
    renderActions({ isAssistant: false });
    expect(screen.getByRole("button", { name: /copy message/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /regenerate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export answer/i })).not.toBeInTheDocument();
  });

  it("shows Copy, feedback, Regenerate, and Export for an assistant message by default", () => {
    renderActions({ isAssistant: true, onFeedback: vi.fn(), onRegenerate: vi.fn() });
    expect(screen.getByRole("button", { name: /copy message/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /good response/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate response/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export answer/i })).toBeInTheDocument();
  });

  it("hides Regenerate when showRegenerate is false (compliance reports)", () => {
    renderActions({ isAssistant: true, showRegenerate: false });
    expect(screen.queryByRole("button", { name: /regenerate response/i })).not.toBeInTheDocument();
    // Copy and export should still be there.
    expect(screen.getByRole("button", { name: /copy message/i })).toBeInTheDocument();
  });

  it("does not render a Show sources toggle when onToggleSources is not provided", () => {
    renderActions({ isAssistant: true, onToggleSources: null });
    expect(screen.queryByRole("button", { name: /show sources/i })).not.toBeInTheDocument();
  });

  it("renders Show sources and reflects sourcesVisible state", async () => {
    const user = userEvent.setup();
    const onToggleSources = vi.fn();
    renderActions({ isAssistant: true, onToggleSources, sourcesVisible: false });

    const toggle = screen.getByRole("button", { name: "Show sources" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(onToggleSources).toHaveBeenCalledTimes(1);
  });

  it("labels the toggle 'Hide sources' when sourcesVisible is true", () => {
    renderActions({ isAssistant: true, onToggleSources: vi.fn(), sourcesVisible: true });
    expect(screen.getByRole("button", { name: "Hide sources" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("shows the version switcher only when hasMultipleVersions is true", () => {
    const { rerender } = renderActions({ isAssistant: true, hasMultipleVersions: false });
    expect(screen.queryByRole("button", { name: /previous version/i })).not.toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <MessageActions
          content="An answer."
          isAssistant
          hasMultipleVersions
          activeVersionIndex={1}
          totalVersions={3}
          onSwitchVersion={vi.fn()}
        />
      </TooltipProvider>
    );
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("disables Previous version at the first version and Next at the last", () => {
    renderActions({
      isAssistant: true,
      hasMultipleVersions: true,
      activeVersionIndex: 0,
      totalVersions: 2,
      onSwitchVersion: vi.fn(),
    });
    expect(screen.getByRole("button", { name: /previous version/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next version/i })).not.toBeDisabled();
  });

  it("calls onSwitchVersion with the next index when Next version is clicked", async () => {
    const user = userEvent.setup();
    const onSwitchVersion = vi.fn();
    renderActions({
      isAssistant: true,
      hasMultipleVersions: true,
      activeVersionIndex: 0,
      totalVersions: 2,
      onSwitchVersion,
    });
    await user.click(screen.getByRole("button", { name: /next version/i }));
    expect(onSwitchVersion).toHaveBeenCalledWith(1);
  });
});
