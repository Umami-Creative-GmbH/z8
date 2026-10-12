import { createCapacitorConfig, resolveShellSettings } from "./shell-config.ts";

// Read by `cap sync`, which copies the result into the native projects.
// Set Z8_APP_ORIGIN (and optionally Z8_APP_ALLOWED_HOSTS) before syncing.
export default createCapacitorConfig(resolveShellSettings(process.env));
