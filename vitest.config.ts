import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Tests always run against the committed sample, never the owner's portfolio.
const sampleConfig = resolve(__dirname, "pulse.config.example.ts");
const wranglerConfig = existsSync("./wrangler.toml") ? "./wrangler.toml" : "./wrangler.example.toml";

export default defineWorkersConfig({
  resolve: { alias: { "pulse-config": sampleConfig } },
  test: {
    include: ["tests/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: wranglerConfig, environment: "production" },
      },
    },
  },
});
