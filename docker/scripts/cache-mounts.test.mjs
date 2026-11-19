import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheTransferInvocation, directoryBytes } from "./cache-mounts.mjs";

test("cache transfer uses matching mount IDs and always executes a fresh transfer", () => {
	for (const mode of ["restore", "export"]) {
		const invocation = cacheTransferInvocation(mode, "cache with spaces", "linux/arm64");
		assert.ok(invocation.args.includes("--no-cache"));
		assert.ok(invocation.args.includes("linux/arm64"));
		assert.match(invocation.input, /id=pnpm-store,target=\/cache\/pnpm/);
		assert.match(invocation.input, /id=next-cache,target=\/cache\/next/);
		assert.doesNotMatch(invocation.input, /secret|encryption|COPY \. \/app/);
	}
	assert.ok(
		cacheTransferInvocation("restore", "cache", "linux/amd64").args.includes("type=cacheonly"),
	);
	assert.match(
		cacheTransferInvocation("export", "cache", "linux/amd64").args.find((arg) =>
			arg.startsWith("type=local"),
		),
		/dest=/,
	);
	assert.throws(() => cacheTransferInvocation("delete", "cache", "linux/amd64"));
	assert.throws(() => cacheTransferInvocation("restore", "cache", "windows/amd64"));
});

test("cache size accounting bounds exported storage", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "z8-cache-size-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(path.join(root, "entry"), "12345");
	assert.equal(await directoryBytes(root), 5);
});
