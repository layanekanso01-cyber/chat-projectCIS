import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComplianceChecklist } from "./ComplianceChecklist";

const ITEM = (overrides) => ({
  control_number: 1,
  control_title: "Inventory and Control of Enterprise Assets",
  status: "Gap",
  reason: "No asset inventory is mentioned.",
  ...overrides,
});

describe("ComplianceChecklist", () => {
  it("shows 0 of 18 with no checklist items yet", () => {
    render(<ComplianceChecklist checklist={[]} isStreaming />);
    expect(screen.getByText("Checked 0 of 18 Controls...")).toBeInTheDocument();
  });

  it("shows a trailing period instead of ellipsis once streaming is done", () => {
    render(<ComplianceChecklist checklist={[]} isStreaming={false} />);
    expect(screen.getByText("Checked 0 of 18 Controls.")).toBeInTheDocument();
  });

  it("renders a card per item with its control number, title, status, and reason", () => {
    render(<ComplianceChecklist checklist={[ITEM()]} isStreaming={false} />);
    expect(
      screen.getByText("Control 1: Inventory and Control of Enterprise Assets")
    ).toBeInTheDocument();
    expect(screen.getByText("Gap")).toBeInTheDocument();
    expect(screen.getByText("No asset inventory is mentioned.")).toBeInTheDocument();
  });

  it("shows the 'Checking Control N...' placeholder while streaming and incomplete", () => {
    render(<ComplianceChecklist checklist={[ITEM()]} isStreaming />);
    expect(screen.getByText("Checking Control 2...")).toBeInTheDocument();
  });

  it("hides the placeholder once streaming stops, even if incomplete", () => {
    render(<ComplianceChecklist checklist={[ITEM()]} isStreaming={false} />);
    expect(screen.queryByText(/Checking Control/)).not.toBeInTheDocument();
  });

  it("hides the placeholder and shows a period once all 18 controls are checked, even if isStreaming is still true", () => {
    const fullChecklist = Array.from({ length: 18 }, (_, i) => ITEM({ control_number: i + 1 }));
    render(<ComplianceChecklist checklist={fullChecklist} isStreaming />);
    expect(screen.queryByText(/Checking Control/)).not.toBeInTheDocument();
    expect(screen.getByText("Checked 18 of 18 Controls.")).toBeInTheDocument();
  });

  it("falls back to the Unclear style for an unrecognized status", () => {
    render(<ComplianceChecklist checklist={[ITEM({ status: "Weird" })]} isStreaming={false} />);
    const badge = screen.getByText("Weird");
    expect(badge.className).toContain("border-border");
  });
});
