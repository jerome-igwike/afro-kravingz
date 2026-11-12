import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const entryPoints = [
  { in: "server/entries/reservations.ts", out: "api/reservations.mjs" },
  { in: "server/entries/waitlist.ts", out: "api/waitlist.mjs" },
  { in: "server/entries/admin-orders.ts", out: "api/admin/orders.mjs" },
  { in: "server/entries/admin-action.ts", out: "api/admin/action.mjs" },
];

await Promise.all(
  entryPoints.map(entry =>
    build({
      entryPoints: [path.resolve(rootDir, entry.in)],
      outfile: path.resolve(rootDir, entry.out),
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      packages: "external",
      sourcemap: false,
      logLevel: "info",
    }),
  ),
);
