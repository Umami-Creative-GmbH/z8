import { mkdir, writeFile, readFile } from "node:fs/promises";
const required = ["Z8_DESKTOP_UPDATE_ENDPOINT", "Z8_DESKTOP_UPDATE_PUBLIC_KEY", "Z8_WINDOWS_SIGN_COMMAND", "Z8_WINDOWS_SIGNER_THUMBPRINT", "TAURI_SIGNING_PRIVATE_KEY"];
for (const name of required) if (!process.env[name]?.trim()) throw new Error("Release configuration missing: " + name);
const endpoint = new URL(process.env.Z8_DESKTOP_UPDATE_ENDPOINT);
if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) throw new Error("Update endpoint must use trusted HTTPS.");
if (!process.env.Z8_WINDOWS_SIGN_COMMAND.includes("%1")) throw new Error("Windows signing command must include Tauri's %1 file placeholder.");
const app = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url)));
if (config.version !== app.version || process.env.RELEASE_VERSION !== app.version) throw new Error("The release version must match package.json and tauri.conf.json.");
const cargo = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
if (!cargo.includes('version = "' + app.version + '"')) throw new Error("Cargo version must match the release version.");
await mkdir(new URL("../.release/", import.meta.url), { recursive: true });
await writeFile(new URL("../.release/tauri.release.json", import.meta.url), JSON.stringify({
  plugins: { updater: { pubkey: process.env.Z8_DESKTOP_UPDATE_PUBLIC_KEY } },
  bundle: { createUpdaterArtifacts: true, windows: { signCommand: process.env.Z8_WINDOWS_SIGN_COMMAND } },
}, null, 2));
console.log("Release configuration validated for " + app.version + ". Signing credentials are not printed.");