import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyStandalone } from "./verify-standalone.mjs";

async function artifact(t) {
	const root = await mkdtemp(path.join(tmpdir(), "z8-standalone-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const filename of [
		"server.js",
		".next/BUILD_ID",
		"public/fonts/avv/NotoSans-Regular.ttf",
		"public/fonts/avv/DroidSansFallbackFull.ttf",
	]) {
		const target = path.join(root, "apps/webapp", filename);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, "fixture");
	}
	await mkdir(path.join(root, "apps/webapp/.next/static"), { recursive: true });
	return root;
}

test("a self-contained artifact resolves its own runtime package", async (t) => {
	const root = await artifact(t);
	await mkdir(path.join(root, "node_modules/fixture"), { recursive: true });
	await writeFile(path.join(root, "node_modules/fixture/index.js"), "module.exports = {};");
	assert.deepEqual(await verifyStandalone(root, { packages: ["fixture"] }), {
		packages: 1,
		native: false,
	});
});

test("missing package and missing public assets fail qualification", async (t) => {
	const root = await artifact(t);
	await assert.rejects(
		verifyStandalone(root, { packages: ["z8-intentionally-missing-package"] }),
		/Cannot find module/,
	);
	await rm(path.join(root, "apps/webapp/public/fonts/avv/NotoSans-Regular.ttf"));
	await assert.rejects(verifyStandalone(root, { packages: [] }), /ENOENT/);
});

test("a dependency available only beside the artifact cannot qualify it", async (t) => {
	const parent = await mkdtemp(path.join(tmpdir(), "z8-builder-test-"));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const root = path.join(parent, "artifact");
	const fixture = await artifact(t);
	const { cp } = await import("node:fs/promises");
	await cp(fixture, root, { recursive: true });
	await mkdir(path.join(parent, "node_modules/fixture"), { recursive: true });
	await writeFile(path.join(parent, "node_modules/fixture/index.js"), "module.exports = {};");
	await assert.rejects(
		verifyStandalone(root, { packages: ["fixture"] }),
		/dependency escapes artifact/,
	);
});
