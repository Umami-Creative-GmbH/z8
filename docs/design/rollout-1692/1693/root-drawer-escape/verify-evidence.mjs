import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const load = async (file) => JSON.parse(await readFile(join(directory, file), "utf8"));
const before = await load("before.json");
const after = await load("after.json");
const desktop = await load("desktop.json");
const quality = await load("quality.json");
const require = createRequire(resolve("apps/webapp/package.json"));
const sharp = require("sharp");
assert.equal(before.results.length, 3);
assert.equal(after.results.length, 3);
assert.deepEqual(before.errors, []);
assert.deepEqual(after.errors, []);
let images = 0;
for (let index = 0; index < 3; index++) {
	const previous = before.results[index];
	const current = after.results[index];
	assert.deepEqual(previous.variant, current.variant);
	assert.equal(previous.before.font, current.before.font);
	assert.equal(previous.closedAfterFirst, false);
	assert.equal(previous.after.expanded, "true");
	assert.equal(previous.after.sheet.visualOpen, "true");
	assert.equal(previous.second.expanded, "false");
	assert.equal(previous.second.focus.slot, "sidebar-trigger");
	assert.ok(previous.before.tooltips.some((tip) => tip.hidden && tip.display === "none"));
	assert.equal(current.before.tooltips.length, 0);
	assert.equal(current.closedAfterFirst, true);
	assert.equal(current.after.sheet, null);
	assert.equal(current.after.focus.slot, "sidebar-trigger");
	assert.equal(current.second, null);
	assert.ok(current.events.some((event) => event.trusted));
	const sizes = [];
	for (const phase of ["before", "after"]) {
		const { info } = await sharp(join(directory, `${phase}-${current.variant.name}.png`))
			.raw()
			.toBuffer({ resolveWithObject: true });
		sizes.push([info.width, info.height]);
		images++;
	}
	assert.deepEqual(sizes[0], [390, 844]);
	assert.deepEqual(sizes[0], sizes[1]);
}
await sharp(join(directory, "after-desktop-icon-tooltip.png")).raw().toBuffer();
images++;
assert.equal(desktop.collapsedTooltipVisible, true);
assert.equal(desktop.expandingRemovesTooltip, true);
assert.equal(desktop.focusedCalendarLinkRetained, true);
assert.deepEqual(desktop.pageErrors, []);
assert.deepEqual(quality.results.next, {
	get_compilation_issues: { issues: [] },
	get_errors: { configErrors: [], sessionErrors: [] },
});
console.log(JSON.stringify({ pairedPhoneCases: 3, fullyDecodedImages: images, desktopChecks: "pass" }));
