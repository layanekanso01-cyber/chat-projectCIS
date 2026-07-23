import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Unmounts every rendered component after each test — without this, DOM from one
// test leaks into the next, causing "multiple elements found" and stale-click bugs
// that look like real regressions but are actually cross-test pollution.
afterEach(() => {
  cleanup();
});
