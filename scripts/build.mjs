import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Uploading sourcemaps is a side effect, so those builds must execute on cache hits too. */
export function createBuildInvocation(args, environment) {
	const isDirBuild = args[0] === "--dir" && args[1];
	const uploadsSourcemaps = Boolean(
		environment.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
		environment.POSTHOG_PROJECT_ID &&
		environment.POSTHOG_API_KEY,
	);
	const command = isDirBuild
		? ["--dir", args[1], "build", ...args.slice(2)]
		: ["exec", "turbo", "build", ...args, ...(uploadsSourcemaps ? ["--force"] : [])];
	return {
		command,
		env: { ...environment, CI: environment.CI || "true" },
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { command, env } = createBuildInvocation(process.argv.slice(2), process.env);
	const result = spawnSync("pnpm", command, { env, stdio: "inherit" });
	if (result.error) throw result.error;
	process.exit(result.status ?? 1);
}
