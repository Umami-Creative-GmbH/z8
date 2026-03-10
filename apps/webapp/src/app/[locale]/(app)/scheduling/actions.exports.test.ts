import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schedulingDir = dirname(fileURLToPath(import.meta.url));

describe("scheduling actions module structure", () => {
	it("wraps action modules with async exports", () => {
		const actionsSource = readFileSync(join(schedulingDir, "actions.ts"), "utf8");

		expect(actionsSource).toMatch(/getLocationsWithSubareas as getLocationsWithSubareasAction/);
		expect(actionsSource).toMatch(/createShiftTemplate as createShiftTemplateAction/);
		expect(actionsSource).toMatch(/approveShiftRequest as approveShiftRequestAction/);
		expect(actionsSource).toContain("export async function getLocationsWithSubareas(");
		expect(actionsSource).toContain("export async function createShiftTemplate(");
		expect(actionsSource).toContain("export async function approveShiftRequest(");
		expect(actionsSource).not.toMatch(/export\s*\{[^}]+\}\s*from\s*"\.\/actions\//);
	});
});
