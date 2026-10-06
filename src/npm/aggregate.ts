import {
  extractRepositoryUrl,
  resolveProjectForPackage,
} from "./grouping";
import type {
  NpmPackageRow,
  NpmPayload,
  NpmProjectRow,
  NpmSearchObject,
} from "./types";

export const NPM_TOTAL_NOTE =
  "Package downloads (successful registry tarball responses), not unique people. Counts include CI, mirrors, robots, and scanners; local or proxy caches can suppress new registry requests.";

export interface MaintainerPackage {
  name: string;
  downloads7d: number;
  downloads30d: number;
  repositoryUrl?: string;
}

export function filterExactMaintainerPackages(
  objects: NpmSearchObject[],
  maintainer: string,
): MaintainerPackage[] {
  const normalizedMaintainer = maintainer.trim().toLowerCase();
  const packages: MaintainerPackage[] = [];

  for (const entry of objects) {
    const pkg = entry.package;
    const maintainers = pkg.maintainers ?? [];
    const isMaintainer = maintainers.some(
      (m) => m.username.trim().toLowerCase() === normalizedMaintainer,
    );
    if (!isMaintainer) continue;

    packages.push({
      name: pkg.name,
      downloads7d: entry.downloads?.weekly ?? 0,
      downloads30d: entry.downloads?.monthly ?? 0,
      repositoryUrl: extractRepositoryUrl(pkg),
    });
  }

  return packages;
}

export function sumDownloads(packages: MaintainerPackage[]): {
  total7d: number;
  total30d: number;
} {
  let total7d = 0;
  let total30d = 0;
  for (const pkg of packages) {
    total7d += pkg.downloads7d;
    total30d += pkg.downloads30d;
  }
  return { total7d, total30d };
}

export function buildNpmPayload(
  packages: MaintainerPackage[],
  maintainer: string,
  fetchedAt: string,
  options: {
    partialFailure?: boolean;
    warning?: string;
    errors?: string[];
  } = {},
): NpmPayload {
  const { total7d, total30d } = sumDownloads(packages);

  const packageRows: NpmPackageRow[] = packages.map((pkg) => {
    const project = resolveProjectForPackage(pkg.name, pkg.repositoryUrl);
    return {
      name: pkg.name,
      projectKey: project.key,
      projectLabel: project.label,
      downloads7d: pkg.downloads7d,
      downloads30d: pkg.downloads30d,
      shareOfTotal30d: total30d > 0 ? pkg.downloads30d / total30d : 0,
    };
  });

  packageRows.sort((a, b) => b.downloads30d - a.downloads30d);

  const projectMap = new Map<
    string,
    { label: string; pinned: boolean; packages: MaintainerPackage[] }
  >();

  for (const pkg of packages) {
    const project = resolveProjectForPackage(pkg.name, pkg.repositoryUrl);
    const existing = projectMap.get(project.key);
    if (existing) {
      existing.packages.push(pkg);
    } else {
      projectMap.set(project.key, {
        label: project.label,
        pinned: project.pinned,
        packages: [pkg],
      });
    }
  }

  const projectRows: NpmProjectRow[] = [...projectMap.entries()].map(
    ([key, value]) => {
      const downloads7d = value.packages.reduce((sum, p) => sum + p.downloads7d, 0);
      const downloads30d = value.packages.reduce((sum, p) => sum + p.downloads30d, 0);
      return {
        key,
        label: value.label,
        packageCount: value.packages.length,
        downloads7d,
        downloads30d,
        shareOfTotal30d: total30d > 0 ? downloads30d / total30d : 0,
        pinned: value.pinned,
      };
    },
  );

  projectRows.sort((a, b) => b.downloads30d - a.downloads30d);

  return {
    maintainer,
    packageCount: packages.length,
    totalDownloads7d: total7d,
    totalDownloads30d: total30d,
    totalNote: NPM_TOTAL_NOTE,
    projects: projectRows,
    packages: packageRows,
    fetchedAt,
    cache: { fresh: true, ageSeconds: 0, stale: false, source: "live" },
    partialFailure: options.partialFailure ?? false,
    warning: options.warning,
    errors: options.errors ?? [],
  };
}

export function buildEmptyNpmPayload(
  maintainer: string,
  fetchedAt: string,
  errors: string[],
): NpmPayload {
  return buildNpmPayload([], maintainer, fetchedAt, {
    partialFailure: errors.length > 0,
    errors,
  });
}
