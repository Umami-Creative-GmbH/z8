import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webapp = path.resolve(__dirname, "../../..");
/**
 * Source scan, because the design-system Checkbox renders a hidden native input for form
 * integration and a DOM query can't tell them apart.
 */
const PAGE_FILES = [
	"src/app/[locale]/(app)/driving-licence/page.tsx",
	"src/app/[locale]/(app)/driving-licence/layout.tsx",
	"src/app/[locale]/(app)/driving-licence/checks/[employee]/page.tsx",
	"src/components/driving-licence/role-tabs.tsx",
	"src/components/driving-licence/my-licence.tsx",
	"src/components/driving-licence/check-worklist.tsx",
	"src/components/driving-licence/check-panel.tsx",
	"src/components/driving-licence/original-check-form.tsx",
	"src/components/driving-licence/reinstate-authorization.tsx",
	"src/components/driving-licence/check-evidence.tsx",
	"src/components/driving-licence/deadline-date.tsx",
	"src/components/driving-licence/history-panel.tsx",
	"src/components/driving-licence/history-timeline.tsx",
	"src/components/driving-licence/history-original.tsx",
	"src/components/driving-licence/supplement-form.tsx",
	"src/components/driving-licence/report-impediment.tsx",
	"src/components/driving-licence/operational-status.tsx",
	"src/components/driving-licence/reminder-tasks.tsx",
	"src/components/driving-licence/verifier-settings.tsx",
];

describe("/driving-licence controls", () => {
	it.each(PAGE_FILES)("%s renders no native checkbox", (file) => {
		const source = readFileSync(path.join(webapp, file), "utf8");
		expect(source).not.toMatch(/type=\{?\s*["'`]checkbox["'`]/);
	});
	// The check and reinstatement forms choose results and scopes with the design-system
	// Select (#1429).
	it.each([
		"src/components/driving-licence/original-check-form.tsx",
		"src/components/driving-licence/reinstate-authorization.tsx",
	])("%s renders no native select", (file) => {
		const source = readFileSync(path.join(webapp, file), "utf8");
		expect(source).not.toMatch(/<select[\s>]/);
	});
});
