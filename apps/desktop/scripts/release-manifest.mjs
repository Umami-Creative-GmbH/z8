import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { httpsUrl, readVersion } from "./release-config.mjs";
const directory = resolve("src-tauri/target/release/bundle/nsis");
const installers = (await readdir(directory)).filter((file) =>
	file.endsWith("-setup.exe"),
);
if (installers.length !== 1)
	throw new Error("Expected exactly one Windows NSIS installer.");
const file = installers[0],
	signature = (
		await readFile(resolve(directory, file + ".sig"), "utf8")
	).trim();
if (!signature) throw new Error("Updater signature is missing.");
const base = httpsUrl(
	process.env.Z8_DESKTOP_DOWNLOAD_BASE_URL,
	"Download base",
);
if (!base.pathname.endsWith("/")) base.pathname += "/";
const version = await readVersion("package.json");
await writeFile(
	resolve(directory, "latest.json"),
	JSON.stringify(
		{
			version,
			notes: "Z8 Timer " + version,
			pub_date: new Date().toISOString(),
			platforms: {
				"windows-x86_64": {
					signature,
					url: new URL(encodeURIComponent(basename(file)), base).href,
				},
			},
		},
		null,
		2,
	),
);
console.log(
	"Prepared latest.json. Publish only after the installed-app acceptance checks pass.",
);
