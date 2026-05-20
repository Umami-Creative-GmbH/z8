import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

function functionBody(name: string) {
	const start = source.indexOf(`export async function ${name}`);
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

function expectBillingGuardBeforeWrite(name: string, writeMarker: string) {
	const body = functionBody(name);
	const guardIndex = body.indexOf("requireBillingForMutation");
	const writeIndex = body.indexOf(writeMarker);

	expect(guardIndex, `${name} should require billing before mutating`).toBeGreaterThanOrEqual(0);
	expect(body).toContain("isBillingMutationAllowed");
	expect(body).toContain('error: "billing_required"');
	expect(body).toContain('code: billingAccess.reason ?? "subscription_required"');
	expect(writeIndex, `${name} should include expected write marker`).toBeGreaterThanOrEqual(0);
	expect(guardIndex, `${name} should guard before database writes`).toBeLessThan(writeIndex);
}

describe("legacy time-tracking action billing guards", () => {
	it("imports the shared billing mutation guard helpers", () => {
		expect(source).toContain(
			'import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard"',
		);
	});

	it("guards clock-in before creating time entries", () => {
		expectBillingGuardBeforeWrite("clockIn", "createTimeEntry({");
	});

	it("guards clock-out before creating time entries", () => {
		expectBillingGuardBeforeWrite("clockOut", "createTimeEntry({");
	});

	it("guards manual time-entry creation before creating time entries", () => {
		expectBillingGuardBeforeWrite("createManualTimeEntry", "createTimeEntry({");
	});
});
