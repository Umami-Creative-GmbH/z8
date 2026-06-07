import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const isDirBuild = args[0] === "--dir" && args[1];

const command =
	isDirBuild
		? ["--dir", args[1], "build", ...args.slice(2)]
		: ["exec", "turbo", "build", ...args];

const env = isDirBuild ? { ...process.env, CI: process.env.CI || "true" } : process.env;

const result = spawnSync("pnpm", command, { env, stdio: "inherit" });

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 1);
