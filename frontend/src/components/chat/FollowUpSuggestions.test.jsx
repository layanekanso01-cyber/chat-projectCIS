import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FollowUpSuggestions } from "./FollowUpSuggestions";

describe("FollowUpSuggestions", () => {
  it("renders nothing for an empty question list", () => {
    const { container } = render(<FollowUpSuggestions questions={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when questions is null", () => {
    const { container } = render(<FollowUpSuggestions questions={null} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one button per question", () => {
    render(
      <FollowUpSuggestions
        questions={["What is Control 1?", "What is Control 2?"]}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "What is Control 1?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is Control 2?" })).toBeInTheDocument();
  });

  it("calls onSelect with the exact question text when clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<FollowUpSuggestions questions={["What is Control 3?"]} onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: "What is Control 3?" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("What is Control 3?");
  });
});
