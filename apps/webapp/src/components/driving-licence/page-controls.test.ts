import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webapp = path.resolve(__dirname, "../../..");
/**
 * Source scan, because the design-system Checkbox renders a hidden native input for form
 * integration and a DOM query can't tell them apart.
 *
 * The inline check and reinstatement forms (`original-check-form.tsx`,
 * `reinstate-authorization.tsx`) still carry native checkboxes; #1429 converts them on the
 * check page and adds them here.
 */
const PAGE_FILES = [
	"src/app/[locale]/(app)/driving-licence/page.tsx",
	"src/app/[locale]/(app)/driving-licence/layout.tsx",
	"src/components/driving-licence/role-tabs.tsx",
	"src/components/driving-licence/my-licence.tsx",
	"src/components/driving-licence/check-worklist.tsx",
	"src/components/driving-licence/check-panel.tsx",
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
});
