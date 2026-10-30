import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import path from "path";
import { repoRoot } from "../src/utils/root";

/**
 * Opens a public Cloudflare quick tunnel to the server so the OCR service can download uploads,
 * and saves its address in data/ocr-public-base.txt, which ocrFileUrl() reads on every upload.
 * Usage: npm run tunnel [port]   (default 8080, the port src/index.ts listens on)
 */
const port = process.argv[2] || "8080";
const root = repoRoot();
const binary = [path.join(root, "data", "bin", "cloudflared"), "cloudflared"].find((item) => item === "cloudflared" || existsSync(item))!;
const baseFile = path.join(root, "data", "ocr-public-base.txt");

console.log(`Opening a public tunnel to http://localhost:${port} …`);
const child = spawn(binary, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });

let published = false;
const watch = (chunk: Buffer) => {
  const found = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!found || published) return;
  published = true;
  writeFileSync(baseFile, `${found[0]}\n`);
  console.log(`Public address: ${found[0]}`);
  console.log("Saved to data/ocr-public-base.txt. Uploaded files are sent to OCR through it. Keep this running; Ctrl+C stops it.");
};
child.stdout.on("data", watch);
child.stderr.on("data", watch);
child.on("error", (error) => {
  console.error(`Could not start cloudflared: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code) => {
  console.log(`Tunnel stopped (${code ?? "signal"}).`);
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
