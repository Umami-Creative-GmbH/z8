import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readCommandSource(fileName: string) {
	return readFileSync(fileURLToPath(new URL(`./${fileName}`, import.meta.url)), "utf8");
}

function expectBillingGuardBeforeWrite(source: string, commandName: string, writeMarker: string) {
	const employeeValidationIndex = source.indexOf("if (!emp)");
	const guardIndex = source.indexOf("await requireBillingForMutation");
	const allowedIndex = source.indexOf("isBillingMutationAllowed");
	const writeIndex = source.indexOf(writeMarker);

	expect(source).toContain(
		'import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard"',
	);
	expect(
		employeeValidationIndex,
		`${commandName} should validate employee organization membership`,
	).toBeGreaterThanOrEqual(0);
	expect(
		guardIndex,
		`${commandName} should require billing before mutating`,
	).toBeGreaterThanOrEqual(0);
	expect(
		allowedIndex,
		`${commandName} should check billing mutation access`,
	).toBeGreaterThanOrEqual(0);
	expect(source).toContain("Billing is required to continue using time tracking");
	expect(writeIndex, `${commandName} should include expected write marker`).toBeGreaterThanOrEqual(
		0,
	);
	expect(guardIndex, `${commandName} should guard after org validation`).toBeGreaterThan(
		employeeValidationIndex,
	);
	expect(guardIndex, `${commandName} should guard before database writes`).toBeLessThan(writeIndex);
}

describe("bot time-tracking command billing guards", () => {
	it("guards clock-in before creating time entries", () => {
		expectBillingGuardBeforeWrite(
			readCommandSource("clock-in.ts"),
			"clock-in",
			".insert(timeEntry)",
		);
	});

	it("guards clock-out before creating time entries", () => {
		expectBillingGuardBeforeWrite(
			readCommandSource("clock-out.ts"),
			"clock-out",
			".insert(timeEntry)",
		);
	});
});
