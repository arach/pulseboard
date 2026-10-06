import { describe, expect, it } from "vitest";
import {
  fallbackProjectGrouping,
  normalizeGitHubRepoKey,
  resolveProjectForPackage,
} from "../src/npm/grouping";

describe("normalizeGitHubRepoKey", () => {
  it.each([
    ["https://github.com/arach/openscout", "arach/openscout"],
    ["git+https://github.com/arach/openscout.git", "arach/openscout"],
    ["git@github.com:arach/lattices.git", "arach/lattices"],
    ["ssh://git@github.com/arach/SpeakEasy", "arach/speakeasy"],
    ["https://github.com/arach/pomo/tree/main/packages/cli", "arach/pomo"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeGitHubRepoKey(input)).toBe(expected);
  });

  it("returns null for non-GitHub URLs", () => {
    expect(normalizeGitHubRepoKey("https://gitlab.com/arach/foo")).toBeNull();
    expect(normalizeGitHubRepoKey(undefined)).toBeNull();
  });
});

describe("resolveProjectForPackage", () => {
  it("applies explicit package overrides before repository grouping", () => {
    // Overrides and scope projects come from pulse.config.example.ts in tests.
    expect(resolveProjectForPackage("quill-md", "https://github.com/other/repo")).toEqual({
      key: "northwind/quill",
      label: "Quill",
      pinned: true,
    });
    expect(resolveProjectForPackage("@tidepool-demo/cli", undefined)).toEqual({
      key: "northwind/tidepool",
      label: "Tidepool",
      pinned: true,
    });
  });

  it("groups by normalized repository when no override exists", () => {
    expect(
      resolveProjectForPackage("@arach/widget", "git+https://github.com/arach/widget.git"),
    ).toEqual({
      key: "arach/widget",
      label: "Widget",
      pinned: false,
    });
  });
});

describe("fallbackProjectGrouping", () => {
  it("groups scoped packages by scope", () => {
    expect(fallbackProjectGrouping("@arach/orphan")).toEqual({
      key: "scope:arach",
      label: "@arach (unlinked)",
      pinned: false,
    });
  });

  it("groups unscoped packages by package name", () => {
    expect(fallbackProjectGrouping("standalone-lib")).toEqual({
      key: "pkg:standalone-lib",
      label: "standalone-lib",
      pinned: false,
    });
  });
});
