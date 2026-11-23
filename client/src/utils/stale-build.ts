/**
 * After a deploy the old program files are gone. A tab opened before the deploy still asks for them, and opening a
 * screen that is loaded on demand (the document viewer, for example) fails with "Failed to fetch dynamically imported
 * module". Reloading picks up the new version; a short guard stops a reload loop if the file is really missing.
 */
const KEY = "coalash-stale-reload";

export function isStaleBuildError(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Loading chunk .* failed|Unable to preload CSS/i.test(text);
}

/** Reloads once onto the new version. False when it already did so in the last 30 seconds. */
export function reloadForNewBuild() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked: still reload once */
  }
  window.location.reload();
  return true;
}

export function installStaleBuildReload() {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isStaleBuildError(event.reason)) reloadForNewBuild();
  });
}
