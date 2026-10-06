import { CONFIG } from "../config";
import type { NpmProjectRef } from "../types";

/** Explicit package → project overrides (applied before repository-derived grouping). */
export const PACKAGE_PROJECT_OVERRIDES: Record<string, NpmProjectRef> = CONFIG.npm.projectOverrides;

export function resolveProjectForPackage(
  packageName: string,
  repositoryUrl: string | undefined,
): NpmProjectRef {
  const override = PACKAGE_PROJECT_OVERRIDES[packageName];
  if (override) return override;

  const scoped = packageName.startsWith("@") ? CONFIG.npm.scopeProjects[packageName.split("/")[0]] : undefined;
  if (scoped) return scoped;

  const repoKey = normalizeGitHubRepoKey(repositoryUrl);
  if (repoKey) {
    return {
      key: repoKey,
      label: formatRepoLabel(repoKey),
      pinned: false,
    };
  }

  return fallbackProjectGrouping(packageName);
}

export function normalizeGitHubRepoKey(url: string | undefined): string | null {
  if (!url) return null;

  let normalized = url.trim();
  if (!normalized) return null;

  normalized = normalized.replace(/^git\+/, "");
  normalized = normalized.replace(/^git:\/\//, "https://");
  normalized = normalized.replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  normalized = normalized.replace(/^git@github\.com:/, "https://github.com/");

  const sshMatch = normalized.match(/^git@github\.com:([^/]+\/[^/#?]+)/);
  if (sshMatch) return cleanRepoPath(sshMatch[1]);

  try {
    const parsed = new URL(normalized.split("#")[0].split("?")[0]);
    if (!parsed.hostname.endsWith("github.com")) return null;
    const parts = parsed.pathname.replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return cleanRepoPath(`${parts[0]}/${parts[1]}`);
  } catch {
    const loose = normalized.match(/github\.com[/:]([^/]+\/[^/.]+)/);
    return loose ? cleanRepoPath(loose[1]) : null;
  }
}

function cleanRepoPath(path: string): string {
  return path.replace(/\.git$/i, "").toLowerCase();
}

function formatRepoLabel(repoKey: string): string {
  const [, repo] = repoKey.split("/");
  if (!repo) return repoKey;
  if (repo.toLowerCase() === repo) {
    return repo.charAt(0).toUpperCase() + repo.slice(1);
  }
  return repo;
}

export function fallbackProjectGrouping(packageName: string): {
  key: string;
  label: string;
  pinned: boolean;
} {
  if (packageName.startsWith("@")) {
    const scope = packageName.split("/")[0];
    const scopeName = scope.slice(1);
    return {
      key: `scope:${scopeName}`,
      label: `${scope} (unlinked)`,
      pinned: false,
    };
  }

  return {
    key: `pkg:${packageName}`,
    label: packageName,
    pinned: false,
  };
}

export function extractRepositoryUrl(pkg: {
  links?: { repository?: string };
  repository?: { url?: string };
}): string | undefined {
  return pkg.repository?.url ?? pkg.links?.repository;
}
