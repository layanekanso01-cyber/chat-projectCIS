import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Triggers a client-side file download of `text` — no backend involvement needed. */
export function downloadTextFile(filename, text, mimeType = "text/markdown") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function checklistToMarkdown(checklist) {
  const lines = ["## Compliance Check Results", ""];
  for (const item of checklist) {
    lines.push(
      `${item.control_number}. **Control ${item.control_number}: ${item.control_title}** — ${item.status}`
    );
    lines.push(`   ${item.reason}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function conversationToMarkdown(conversation) {
  const lines = [`# ${conversation.title || "Conversation"}`, ""];
  for (const message of conversation.messages || []) {
    const speaker = message.role === "user" ? "**You**" : "**Assistant**";
    lines.push(`${speaker}: ${message.content}`);
    if (message.role === "assistant" && message.sources?.length) {
      lines.push(sourcesToMarkdown(message.sources).trim());
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function slugify(text) {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "conversation"
  );
}

export function sourcesToMarkdown(sources) {
  if (!sources || sources.length === 0) return "";
  const lines = sources.map((source, index) => {
    const label = source.control_label ? ` (${source.control_label})` : "";
    return `${index + 1}. ${source.source || "CIS Controls v8"}${label}\n   > ${source.quote || ""}`;
  });
  return `\n\n**Sources**\n\n${lines.join("\n")}`;
}

/**
 * Buckets conversations into ChatGPT-style recency groups ("Pinned", "Today",
 * "Previous 7 days", "Older"), preserving each group's existing order.
 */
export function groupConversationsByRecency(conversations) {
  const today = startOfDay(new Date());
  const sevenDaysAgo = today - 7 * 86400000;

  const pinned = [];
  const groups = { Today: [], "Previous 7 days": [], Older: [] };
  for (const conversation of conversations) {
    if (conversation.pinned) {
      pinned.push(conversation);
      continue;
    }
    const timestamp = new Date(conversation.updated_at).getTime();
    if (timestamp >= today) groups["Today"].push(conversation);
    else if (timestamp >= sevenDaysAgo) groups["Previous 7 days"].push(conversation);
    else groups["Older"].push(conversation);
  }

  const result = [];
  if (pinned.length > 0) result.push({ label: "Pinned", items: pinned });
  for (const [label, items] of Object.entries(groups)) {
    if (items.length > 0) result.push({ label, items });
  }
  return result;
}

const DATE_FILTER_CHECKS = {
  today: (timestamp, today) => timestamp >= today,
  week: (timestamp, today) => timestamp >= today - 7 * 86400000,
  month: (timestamp, today) => timestamp >= today - 30 * 86400000,
  older: (timestamp, today) => timestamp < today - 30 * 86400000,
};

export const DATE_FILTER_LABELS = {
  all: "All time",
  today: "Today",
  week: "This week",
  month: "This month",
  older: "Older",
};

export function filterConversationsByDate(conversations, filter) {
  const check = DATE_FILTER_CHECKS[filter];
  if (!check) return conversations;
  const today = startOfDay(new Date());
  return conversations.filter((conversation) =>
    check(new Date(conversation.updated_at).getTime(), today)
  );
}
