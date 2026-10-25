import { defineConfig } from "vite";

// Relative base so the production build's asset URLs (./assets/...) resolve
// correctly when Electron loads dist/index.html through the file:// protocol.
// Without this, Vite emits absolute /assets/... paths that 404 under file://
// and leave the packaged app on a blank white screen.
export default defineConfig({
  base: "./",
});
