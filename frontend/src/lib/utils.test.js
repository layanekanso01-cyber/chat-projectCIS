import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checklistToMarkdown,
  conversationToMarkdown,
  filterConversationsByDate,
  groupConversationsByRecency,
  slugify,
  sourcesToMarkdown,
} from "./utils";

const NOW = new Date("2026-07-22T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function conversation(overrides) {
  return {
    conversation_id: "conv_1",
    title: "Untitled",
    pinned: false,
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

describe("groupConversationsByRecency", () => {
  it("puts pinned conversations in their own group regardless of date", () => {
    const old = conversation({
      conversation_id: "old",
      pinned: true,
      updated_at: "2020-01-01T00:00:00.000Z",
    });
    const groups = groupConversationsByRecency([old]);
    expect(groups[0].label).toBe("Pinned");
    expect(groups[0].items).toEqual([old]);
  });

  it("buckets an unpinned conversation from today into Today", () => {
    const today = conversation({ conversation_id: "today", updated_at: NOW.toISOString() });
    const groups = groupConversationsByRecency([today]);
    expect(groups).toEqual([{ label: "Today", items: [today] }]);
  });

  it("buckets a 3-day-old conversation into Previous 7 days", () => {
    const threeDaysAgo = new Date(NOW.getTime() - 3 * 86400000).toISOString();
    const recent = conversation({ conversation_id: "recent", updated_at: threeDaysAgo });
    const groups = groupConversationsByRecency([recent]);
    expect(groups).toEqual([{ label: "Previous 7 days", items: [recent] }]);
  });

  it("buckets a 30-day-old conversation into Older", () => {
    const monthAgo = new Date(NOW.getTime() - 30 * 86400000).toISOString();
    const stale = conversation({ conversation_id: "stale", updated_at: monthAgo });
    const groups = groupConversationsByRecency([stale]);
    expect(groups).toEqual([{ label: "Older", items: [stale] }]);
  });

  it("omits empty groups entirely", () => {
    const today = conversation({ conversation_id: "today" });
    const groups = groupConversationsByRecency([today]);
    expect(groups.map((g) => g.label)).toEqual(["Today"]);
  });

  it("returns an empty array for no conversations", () => {
    expect(groupConversationsByRecency([])).toEqual([]);
  });
});

describe("filterConversationsByDate", () => {
  const today = conversation({ conversation_id: "today", updated_at: NOW.toISOString() });
  const threeDaysAgo = conversation({
    conversation_id: "3d",
    updated_at: new Date(NOW.getTime() - 3 * 86400000).toISOString(),
  });
  const twentyDaysAgo = conversation({
    conversation_id: "20d",
    updated_at: new Date(NOW.getTime() - 20 * 86400000).toISOString(),
  });
  const sixtyDaysAgo = conversation({
    conversation_id: "60d",
    updated_at: new Date(NOW.getTime() - 60 * 86400000).toISOString(),
  });
  const all = [today, threeDaysAgo, twentyDaysAgo, sixtyDaysAgo];

  it("'all' returns everything unfiltered", () => {
    expect(filterConversationsByDate(all, "all")).toEqual(all);
  });

  it("'today' returns only today's conversations", () => {
    expect(filterConversationsByDate(all, "today")).toEqual([today]);
  });

  it("'week' includes today and 3 days ago, excludes 20/60 days ago", () => {
    expect(filterConversationsByDate(all, "week")).toEqual([today, threeDaysAgo]);
  });

  it("'month' includes everything within 30 days, excludes 60 days ago", () => {
    expect(filterConversationsByDate(all, "month")).toEqual([today, threeDaysAgo, twentyDaysAgo]);
  });

  it("'older' includes only what's past 30 days", () => {
    expect(filterConversationsByDate(all, "older")).toEqual([sixtyDaysAgo]);
  });

  it("an unknown filter value returns everything unfiltered", () => {
    expect(filterConversationsByDate(all, "bogus")).toEqual(all);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Explain Control 3")).toBe("explain-control-3");
  });

  it("strips leading/trailing hyphens produced by punctuation", () => {
    expect(slugify("  What is CIS?!  ")).toBe("what-is-cis");
  });

  it("falls back to 'conversation' for empty/symbol-only input", () => {
    expect(slugify("???")).toBe("conversation");
    expect(slugify("")).toBe("conversation");
  });
});

describe("sourcesToMarkdown", () => {
  it("returns an empty string for no sources", () => {
    expect(sourcesToMarkdown([])).toBe("");
    expect(sourcesToMarkdown(null)).toBe("");
  });

  it("numbers sources and includes the control label when present", () => {
    const markdown = sourcesToMarkdown([
      { source: "cis.pdf", control_label: "Control 3", quote: "Some quote." },
    ]);
    expect(markdown).toContain("1. cis.pdf (Control 3)");
    expect(markdown).toContain("> Some quote.");
  });

  it("falls back to a generic label when control_label is missing", () => {
    const markdown = sourcesToMarkdown([{ source: "cis.pdf", quote: "x" }]);
    expect(markdown).toContain("1. cis.pdf\n");
  });
});

describe("checklistToMarkdown", () => {
  it("formats every item with its number, title, and status", () => {
    const markdown = checklistToMarkdown([
      { control_number: 1, control_title: "Inventory and Control of Enterprise Assets", status: "Gap", reason: "No inventory." },
      { control_number: 2, control_title: "Inventory and Control of Software Assets", status: "Covered", reason: "Allowlist in place." },
    ]);
    expect(markdown).toContain("1. **Control 1: Inventory and Control of Enterprise Assets** — Gap");
    expect(markdown).toContain("No inventory.");
    expect(markdown).toContain("2. **Control 2: Inventory and Control of Software Assets** — Covered");
  });
});

describe("conversationToMarkdown", () => {
  it("labels user and assistant turns and appends sources for assistant messages", () => {
    const markdown = conversationToMarkdown({
      title: "Test chat",
      messages: [
        { role: "user", content: "What is Control 1?" },
        {
          role: "assistant",
          content: "It's about asset inventory.",
          sources: [{ source: "cis.pdf", control_label: "Control 1", quote: "..." }],
        },
      ],
    });
    expect(markdown).toContain("# Test chat");
    expect(markdown).toContain("**You**: What is Control 1?");
    expect(markdown).toContain("**Assistant**: It's about asset inventory.");
    expect(markdown).toContain("**Sources**");
  });

  it("falls back to 'Conversation' when there's no title", () => {
    const markdown = conversationToMarkdown({ messages: [] });
    expect(markdown).toContain("# Conversation");
  });
});
