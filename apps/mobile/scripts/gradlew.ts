// Runs the Android project's Gradle wrapper on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const androidDirectory = fileURLToPath(new URL("../android/", import.meta.url));
const isWindows = process.platform === "win32";
// An absolute path: Windows may be set not to run programs from the current directory.
const wrapper = join(androidDirectory, isWindows ? "gradlew.bat" : "gradlew");

const result = spawnSync(isWindows ? `"${wrapper}"` : wrapper, process.argv.slice(2), {
	cwd: androidDirectory,
	stdio: "inherit",
	shell: isWindows,
});

process.exit(result.status ?? 1);
