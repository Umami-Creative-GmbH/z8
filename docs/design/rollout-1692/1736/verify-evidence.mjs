import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(join(root, "apps/webapp/package.json"));
const sharp = require("sharp");
const sha = (data) => createHash("sha256").update(data).digest("hex");
const json = (name) => JSON.parse(readFileSync(join(directory, name), "utf8"));
let images = 0;
for (const phase of ["before", "after", "after-dark", "after-dark-large"]) {
	const manifest = json(`${phase}-captures.json`);
	for (const source of manifest.sources) {
		if (phase === "before") {
			const old = execFileSync("git", ["show", `${manifest.base}:${source.file}`], { cwd: root });
			if (sha(old) !== source.sha256) throw Error(`Historical source mismatch: ${source.file}`);
		} else if (sha(readFileSync(join(root, source.file))) !== source.sha256) {
			const blob = execFileSync("git", ["hash-object", source.file], { cwd: root, encoding: "utf8" }).trim();
			if (!source.gitBlob || blob !== source.gitBlob) throw Error(`Current source mismatch: ${source.file}`);
		}
	}
	for (const capture of manifest.captures) {
		const path = join(directory, capture.file);
		if (sha(readFileSync(path)) !== capture.sha256) throw Error("Capture hash mismatch");
		const metadata = await sharp(path).metadata();
		if (metadata.width !== capture.measurement.viewport[0] || metadata.height !== capture.measurement.viewport[1]) throw Error("Unexpected PNG geometry");
		if (capture.measurement.headings.length !== 1 || capture.measurement.documentWidth > capture.measurement.viewport[0]) throw Error("Heading or overflow regression");
		images++;
	}
}
const downloads = json("downloads.json");
for (const file of downloads) {
	if (sha(readFileSync(join(directory, "downloads", `${file.kind}.${file.format}`))) !== file.sha256) throw Error("Download mismatch");
	if (!file.completedBrowserEvent) throw Error("Download did not complete");
}
if (downloads.length !== 9) throw Error("Expected nine completed downloads");
console.log(`Verified ${images} accepted decoded PNGs, exact historical/current source hashes, heading/overflow measurements and nine completed file hashes.`);
