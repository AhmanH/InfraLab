import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const snapshotsDir = path.resolve(root, "../snapshots");

function snapshotFile(urlPath) {
  const prefix = "/snapshots/";
  if (!urlPath.startsWith(prefix)) return null;
  const rel = decodeURIComponent(urlPath.slice(prefix.length));
  if (!rel) return null;
  const file = path.resolve(snapshotsDir, rel);
  const relative = path.relative(snapshotsDir, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return file;
}

function sendSnapshot(req, res, next) {
  const urlPath = req.url?.split("?")[0] ?? "";
  const file = snapshotFile(urlPath);
  if (!file) return next();
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    res.end("Snapshot not found");
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-cache");
  fs.createReadStream(file).pipe(res);
}

function snapshotsPlugin() {
  return {
    name: "infralab-snapshots",
    configureServer(server) {
      server.middlewares.use(sendSnapshot);
    },
    generateBundle() {
      if (!fs.existsSync(snapshotsDir)) return;
      for (const name of fs.readdirSync(snapshotsDir)) {
        if (!name.endsWith(".json")) continue;
        this.emitFile({
          type: "asset",
          fileName: `snapshots/${name}`,
          source: fs.readFileSync(path.join(snapshotsDir, name)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), snapshotsPlugin()],
  server: { port: 5173 },
});
