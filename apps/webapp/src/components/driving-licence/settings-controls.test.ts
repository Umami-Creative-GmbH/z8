import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webapp = path.resolve(__dirname, "../../..");
/**
 * `/settings/driving-licence` (#1427): on/off settings are Switches and choices are the
 * design-system Select. A source scan, because the design-system Checkbox and Select render
 * hidden native inputs for form integration and a DOM query can't tell them apart.
 */
const SETTINGS_FILES = [
	"src/app/[locale]/(app)/settings/driving-licence/page.tsx",
	"src/app/[locale]/(app)/settings/driving-licence/layout.tsx",
	"src/components/driving-licence/settings-tabs.tsx",
	"src/components/driving-licence/reassignment-alert.tsx",
	"src/components/driving-licence/policy-settings.tsx",
	"src/components/driving-licence/interval-settings.tsx",
	"src/components/driving-licence/intended-driver-settings.tsx",
	"src/components/driving-licence/verifier-settings.tsx",
	"src/components/driving-licence/retention-settings.tsx",
	"src/components/settings/scoped-feature-assignments.tsx",
	"src/components/settings/access-grants/grant-editor.tsx",
];

describe("/settings/driving-licence controls", () => {
	it.each(SETTINGS_FILES)("%s renders no native checkbox or select", (file) => {
		const source = readFileSync(path.join(webapp, file), "utf8");
		expect(source).not.toMatch(/type=\{?\s*["'`]checkbox["'`]/);
		expect(source).not.toMatch(/<select\b/);
	});
});
