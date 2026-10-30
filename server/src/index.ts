import "./env";
import { existsSync } from "fs";
import path from "path";
import { createApp } from "./app";
import { ensureDatabaseReady } from "./bootstrap";
import { ensureDefaultUsers } from "./services/accounts";
import { storageBackend, storageLabel } from "./services/files";
import { repoRoot } from "./utils/root";

async function main() {
  await ensureDatabaseReady();
  await ensureDefaultUsers().catch((error) => {
    console.error("[db] Default login was not added:", error instanceof Error ? error.message : error);
  });

  const port = Number(process.env.PORT) || 4000;
  const host = process.env.HOST || "0.0.0.0";
  const clientIndex = path.join(repoRoot(), "public", "index.html");
  const app = createApp();

  app.listen(port, host, (error) => {
    if (error) {
      const busy = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      console.error(busy ? `Port ${port} is already in use. Stop the other server (for example npm run dev) or set PORT in server/.env.` : error);
      process.exit(1);
    }
    console.log(`Coal & Ash listening on http://${host}:${port}`);
    console.log(`Storage: ${storageLabel()} (${storageBackend()})`);
    console.log(`Local:  http://localhost:${port}${existsSync(clientIndex) ? " (frontend + API)" : " (API only; run npm run build for the frontend)"}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
