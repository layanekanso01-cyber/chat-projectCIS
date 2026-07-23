import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceCitations } from "./SourceCitations";

const SOURCES = [
  { source: "cis.pdf", chunk_id: 1, control_label: "Control 1", quote: "First quote." },
  { source: "cis.pdf", chunk_id: 2, control_label: "Safeguard 4.7", quote: "Second quote." },
];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe("SourceCitations", () => {
  it("renders nothing when there are no sources", () => {
    const { container } = render(<SourceCitations sources={[]} visible />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when not visible, even with sources", () => {
    const { container } = render(<SourceCitations sources={SOURCES} visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one numbered card per source with its control label", () => {
    render(<SourceCitations sources={SOURCES} visible />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/Control 1/)).toBeInTheDocument();
    expect(screen.getByText(/Safeguard 4.7/)).toBeInTheDocument();
  });

  it("expands a card on click to reveal its quote and a copy button", async () => {
    const user = userEvent.setup();
    render(<SourceCitations sources={SOURCES} visible />);

    expect(screen.queryByText('"First quote."')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button")[0]);
    expect(screen.getByText('"First quote."')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy passage/i })).toBeInTheDocument();
  });

  it("copies the quote to the clipboard and shows confirmation", async () => {
    // Order matters: userEvent.setup() installs its own clipboard mock, so ours
    // must be applied after it (or setup() clobbers it right back).
    const user = userEvent.setup();
    const writeText = stubClipboard();
    // Force card 1 open declaratively so this test only exercises the copy button
    // itself, not the toggle-click sequencing (covered by the test above).
    render(
      <SourceCitations sources={SOURCES} visible highlightedIndex={1} highlightSignal={1} />
    );

    await user.click(screen.getByRole("button", { name: /copy passage/i }));

    expect(writeText).toHaveBeenCalledWith("First quote.");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("force-opens and highlights the card matching highlightedIndex", () => {
    render(
      <SourceCitations
        sources={SOURCES}
        visible
        highlightedIndex={2}
        highlightSignal={1}
      />
    );
    // Card 2 should already show its quote without any click.
    expect(screen.getByText('"Second quote."')).toBeInTheDocument();
    // Card 1 should remain collapsed.
    expect(screen.queryByText('"First quote."')).not.toBeInTheDocument();
  });
});
