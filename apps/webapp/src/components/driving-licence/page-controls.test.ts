import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webapp = path.resolve(__dirname, "../../..");

function sources(directory: string): string[] {
	return readdirSync(path.join(webapp, directory), { withFileTypes: true }).flatMap((entry) => {
		const relative = path.posix.join(directory, entry.name);
		if (entry.isDirectory()) return sources(relative);
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative] : [];
	});
}

/**
 * Every driving licence component and route page uses the design-system Checkbox and Select
 * (#1418). A source scan, because those render hidden native inputs for form integration and
 * a DOM query can't tell them apart.
 */
const FILES = [
	...sources("src/components/driving-licence"),
	...sources("src/app/[locale]/(app)/driving-licence"),
	...sources("src/app/[locale]/(app)/settings/driving-licence"),
];

describe("driving licence controls", () => {
	it("scans the component folder and both route folders", () => {
		expect(FILES).toEqual(
			expect.arrayContaining([
				"src/components/driving-licence/supplement-form.tsx",
				"src/app/[locale]/(app)/driving-licence/page.tsx",
				"src/app/[locale]/(app)/driving-licence/checks/[employee]/page.tsx",
				"src/app/[locale]/(app)/settings/driving-licence/page.tsx",
			]),
		);
	});
	it.each(FILES)("%s renders no native checkbox or select", (file) => {
		const source = readFileSync(path.join(webapp, file), "utf8");
		expect(source).not.toMatch(/type=\{?\s*["'`]checkbox["'`]/);
		expect(source).not.toMatch(/<select[\s>]/);
	});
});
