import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const absencesDir = dirname(fileURLToPath(import.meta.url));

describe("absences actions module structure", () => {
	it("wraps server actions instead of re-exporting them", () => {
		const actionsSource = readFileSync(join(absencesDir, "actions.ts"), "utf8");

		expect(actionsSource).toContain(
			'import { getCurrentEmployee as getCurrentEmployeeAction } from "./current-employee";',
		);
		expect(actionsSource).toMatch(
			/import\s*\{[^}]*cancelAbsenceRequest\s+as\s+cancelAbsenceRequestAction[^}]*\}\s*from\s*"\.\/mutations";/,
		);
		expect(actionsSource).toContain(
			'import { getAbsencePlanPreview as getAbsencePlanPreviewAction } from "./plan-preview";',
		);
		expect(actionsSource).toContain("requestAbsenceEffect as requestAbsenceAction");
		expect(actionsSource).toContain("export async function getCurrentEmployee(");
		expect(actionsSource).toContain("export async function cancelAbsenceRequest(");
		expect(actionsSource).toContain("export async function getAbsencePlanPreview(");
		expect(actionsSource).toContain("return getAbsencePlanPreviewAction(...args);");
		expect(actionsSource).toContain("export async function requestAbsence(");
		expect(actionsSource).not.toMatch(/export\s*\{[^}]+\}\s*from\s*"\.\//);
	});
});
