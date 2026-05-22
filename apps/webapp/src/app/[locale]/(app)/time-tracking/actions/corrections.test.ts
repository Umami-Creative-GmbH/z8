import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const modularSource = readFileSync(
	fileURLToPath(new URL("./corrections.ts", import.meta.url)),
	"utf8",
);
const legacySource = readFileSync(fileURLToPath(new URL("../actions.ts", import.meta.url)), "utf8");

function functionBody(source: string, name: string) {
	const match = new RegExp(`(?:export\\s+)?async function ${name}\\s*\\(`).exec(source);
	const start = match?.index ?? -1;
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("time correction request safety", () => {
	it.each([
		["modular", modularSource],
		["legacy", legacySource],
	])("scopes %s work period lookup to the current employee and organization", (_name, source) => {
		const body = functionBody(source, "requestTimeCorrectionEffect");

		expect(body).toContain("eq(workPeriod.id, data.workPeriodId)");
		expect(body).toContain("eq(workPeriod.employeeId, currentEmployee.id)");
		expect(body).toContain("eq(workPeriod.organizationId, currentEmployee.organizationId)");
	});

	it.each([
		["modular", modularSource],
		["legacy", legacySource],
	])(
		"creates %s correction entries, supersede updates, and approval workflow in one transaction",
		(_name, source) => {
			const body = functionBody(source, "requestTimeCorrectionEffect");
			const transactionIndex = body.indexOf("dbService.db.transaction");
			const clockInIndex = Math.max(
				body.indexOf("createTimeEntry("),
				body.indexOf("createCorrectionEntry"),
			);
			const supersedeIndex = Math.max(
				body.indexOf("markTimeEntrySuperseded"),
				body.indexOf("createCorrectionEntry"),
			);
			const approvalIndex = body.indexOf("createTimeCorrectionApprovalWorkflow(transactionalDbService");
			const emailIndex = body.indexOf("emailService.send");

			expect(transactionIndex).toBeGreaterThanOrEqual(0);
			expect(clockInIndex).toBeGreaterThan(transactionIndex);
			expect(supersedeIndex).toBeGreaterThan(transactionIndex);
			expect(approvalIndex).toBeGreaterThan(transactionIndex);
			expect(emailIndex).toBeGreaterThan(approvalIndex);
		},
	);
});
