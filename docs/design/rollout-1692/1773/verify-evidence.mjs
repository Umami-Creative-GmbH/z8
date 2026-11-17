import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/webapp/package.json"));
const sharp = require("sharp");
const files = await readdir(directory);
for (const file of files.filter((name) => name.endsWith(".json"))) {
	JSON.parse(await readFile(path.join(directory, file), "utf8"));
}
const { info, data } = await sharp(path.join(directory, "blocked-sign-in.png"))
	.raw()
	.toBuffer({ resolveWithObject: true });
assert.equal(info.width, 800);
assert.equal(info.height, 600);
assert.equal(data.length, info.width * info.height * info.channels);

const handoff = path.join(directory, "../1773.md");
const markdown = await readFile(handoff, "utf8");
let localLinks = 0;
for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
	if (/^https?:/.test(match[1])) continue;
	await readFile(path.resolve(path.dirname(handoff), match[1]));
	localLinks++;
}
const manifest = JSON.parse(
	await readFile(path.join(directory, "payload-manifest.json"), "utf8"),
);
for (const file of manifest.files) {
	const bytes = await readFile(path.join(root, file.path));
	const content =
		file.normalization === "LF"
			? Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"))
			: bytes;
	assert.equal(
		createHash("sha256").update(content).digest("hex"),
		file.sha256,
		file.path,
	);
}
console.log(
	JSON.stringify({
		jsonFiles: files.filter((name) => name.endsWith(".json")).length,
		fullyDecodedPng: {
			width: info.width,
			height: info.height,
			channels: info.channels,
		},
		localLinks,
		verifiedPayloadFiles: manifest.files.length,
	}),
);
