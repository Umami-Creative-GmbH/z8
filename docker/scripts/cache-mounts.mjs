import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Same explicit mount IDs as Dockerfile.webapp. Layer cache exporters do not save them.
export function cacheTransferInvocation(mode, directory, platform) {
	if (!["restore", "export"].includes(mode)) throw new Error("Expected restore or export");
	if (!["linux/amd64", "linux/arm64"].includes(platform))
		throw new Error("Unsupported cache platform");
	const root = path.resolve(directory);
	const mounts =
		"--mount=type=cache,id=pnpm-store,target=/cache/pnpm --mount=type=cache,id=next-cache,target=/cache/next";
	const transfer =
		mode === "restore"
			? `COPY . /transfer\nRUN ${mounts} cp -a /transfer/pnpm/. /cache/pnpm/ && cp -a /transfer/next/. /cache/next/ && mkdir /done`
			: `RUN ${mounts} mkdir -p /transfer/pnpm /transfer/next && cp -a /cache/pnpm/. /transfer/pnpm/ && cp -a /cache/next/. /transfer/next/`;
	return {
		args: [
			"buildx",
			"build",
			"--platform",
			platform,
			"--no-cache",
			"--file",
			"-",
			"--output",
			mode === "restore" ? "type=cacheonly" : `type=local,dest=${root}`,
			root,
		],
		input: `# syntax=docker/dockerfile:1.4\nFROM node:26-alpine AS transfer\n${transfer}\nFROM scratch\nCOPY --from=transfer ${mode === "restore" ? "/done /done" : "/transfer /"}\n`,
	};
}

export async function directoryBytes(directory) {
	let bytes = 0;
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const filename = path.join(directory, entry.name);
		// Never follow cache symlinks outside the exported directory.
		bytes += entry.isDirectory() ? await directoryBytes(filename) : (await lstat(filename)).size;
	}
	return bytes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [mode, directory, platform] = process.argv.slice(2);
	const { args, input } = cacheTransferInvocation(mode, directory, platform);
	for (const entry of ["pnpm", "next"])
		await mkdir(path.join(directory, entry), { recursive: true });
	const result = spawnSync("docker", args, {
		input,
		encoding: "utf8",
		stdio: ["pipe", "inherit", "inherit"],
	});
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
	if (mode === "export") {
		const bytes = await directoryBytes(directory);
		const cacheable = bytes <= 512 * 1024 * 1024;
		console.log(`Build cache export: ${bytes} bytes; within 512 MiB limit=${cacheable}`);
		if (process.env.GITHUB_OUTPUT)
			await appendFile(process.env.GITHUB_OUTPUT, `cacheable=${cacheable}\n`);
	}
}
