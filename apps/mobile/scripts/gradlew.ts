// Runs the Android project's Gradle wrapper on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const androidDirectory = fileURLToPath(new URL("../android/", import.meta.url));
const isWindows = process.platform === "win32";

const result = spawnSync(isWindows ? "gradlew.bat" : "./gradlew", process.argv.slice(2), {
	cwd: androidDirectory,
	stdio: "inherit",
	shell: isWindows,
});

process.exit(result.status ?? 1);
