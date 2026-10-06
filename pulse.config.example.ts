import type { PulseConfig } from "./src/types";

/**
 * Sample portfolio with made-up IDs and reserved `.example` domains. Pulse uses
 * this file when `pulse.config.ts` does not exist, and always in tests and the
 * public demo. To track your own properties, copy it to `pulse.config.ts`
 * (gitignored) and fill in your GA4 property and account IDs.
 */
const config: PulseConfig = {
  owner: "Northwind",
  properties: [
    {
      id: "100000001",
      name: "northwind.example",
      accountId: "200000001",
      accountName: "Northwind",
      family: "Northwind",
      domain: "northwind.example",
    },
    {
      id: "100000002",
      name: "docs.northwind.example",
      accountId: "200000001",
      accountName: "Northwind",
      family: "Northwind",
      domain: "docs.northwind.example",
    },
    {
      id: "100000003",
      name: "Beacon",
      accountId: "200000001",
      accountName: "Northwind",
      family: "Beacon",
    },
    {
      id: "100000004",
      name: "fieldnotes.example",
      accountId: "200000002",
      accountName: "Field Notes",
      family: "Field Notes",
      domain: "fieldnotes.example",
    },
    {
      id: "100000005",
      name: "quill.example",
      accountId: "200000003",
      accountName: "Quill",
      family: "Quill",
      domain: "quill.example",
    },
    {
      id: "100000006",
      name: "Echo",
      accountId: "200000003",
      accountName: "Quill",
      family: "Echo",
    },
    {
      id: "100000007",
      name: "tidepool.example",
      accountId: "200000004",
      accountName: "Tidepool",
      family: "Tidepool",
      domain: "tidepool.example",
    },
    {
      id: "100000008",
      name: "lumen.example",
      accountId: "200000005",
      accountName: "Lumen",
      family: "Lumen",
      domain: "lumen.example",
    },
  ],
  npm: {
    maintainer: "northwind-demo",
    projectOverrides: {
      "quill-md": { key: "northwind/quill", label: "Quill", pinned: true },
    },
    scopeProjects: {
      "@tidepool-demo": { key: "northwind/tidepool", label: "Tidepool", pinned: true },
    },
  },
  mock: {
    searchQueries: [
      "northwind", "menu bar timer mac", "quill markdown editor", "tidepool sdk", "local first notes",
      "field notes app", "beacon ios", "lumen icons", "offline sync library", "northwind docs",
    ],
    npmPackages: [
      { name: "@tidepool-demo/sdk", repositoryUrl: "https://github.com/northwind/tidepool", weight: 9 },
      { name: "@tidepool-demo/cli", repositoryUrl: "https://github.com/northwind/tidepool", weight: 4 },
      { name: "quill-md", weight: 6 },
      { name: "@northwind-demo/ui", repositoryUrl: "https://github.com/northwind/ui", weight: 5 },
      { name: "@northwind-demo/icons", repositoryUrl: "https://github.com/northwind/ui", weight: 3 },
      { name: "@northwind-demo/fieldnotes", repositoryUrl: "https://github.com/northwind/fieldnotes", weight: 2 },
      { name: "lumen-icons-demo", repositoryUrl: "https://github.com/northwind/lumen", weight: 1 },
    ],
  },
};

export default config;
