import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function elementContaining(file, marker, closingTag = "/>") {
	const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
	const markerIndex = source.indexOf(marker);
	const start = source.lastIndexOf("<button", markerIndex);
	const end = source.indexOf(closingTag, markerIndex);

	assert.notEqual(markerIndex, -1, `Missing ${marker} in ${file}`);
	assert.notEqual(start, -1, `Missing button before ${marker} in ${file}`);
	assert.notEqual(end, -1, `Missing button close after ${marker} in ${file}`);

	return source.slice(start, end + closingTag.length);
}

for (const [file, marker] of [
	["src/components/OrganizationSelector.tsx", 'className="org-dropdown-backdrop"'],
	["src/components/Settings.tsx", 'background: "rgba(0, 0, 0, 0.4)"'],
]) {
	test(`${file} backdrop is pointer-only`, () => {
		const backdrop = elementContaining(file, marker);

		assert.match(backdrop, /onClick=/);
		assert.match(backdrop, /tabIndex=\{-1\}/);
		assert.match(backdrop, /aria-hidden="true"/);
		assert.match(backdrop, /outline:\s*"none"/);
	});
}

test("Settings explicit close button remains accessible", () => {
	const closeButton = elementContaining(
		"src/components/Settings.tsx",
		"<IconX",
		"</button>",
	);

	assert.match(closeButton, /aria-label="Close settings"/);
	assert.doesNotMatch(closeButton, /aria-hidden/);
	assert.doesNotMatch(closeButton, /tabIndex=\{-1\}/);
});
