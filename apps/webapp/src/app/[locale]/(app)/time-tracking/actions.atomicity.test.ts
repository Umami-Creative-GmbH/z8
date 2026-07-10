import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

function functionBody(name: string) {
	const match = new RegExp(`export\\s+async function ${name}\\s*\\(`).exec(source);
	const start = match?.index ?? -1;
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("legacy clocking transaction boundaries", () => {
	it.each([
		"clockIn",
		"clockOut",
	])("serializes %s by organization and employee before checking active periods", (name) => {
		const body = functionBody(name);
		const transactionIndex = body.indexOf("await db.transaction(async (tx)");
		const lockIndex = body.indexOf("pg_advisory_xact_lock");
		const activePeriodIndex = body.indexOf(".from(workPeriod)", lockIndex);

		expect(transactionIndex).toBeGreaterThanOrEqual(0);
		expect(lockIndex).toBeGreaterThan(transactionIndex);
		expect(body).toMatch(/const lockKey = `\$\{emp\.organizationId\}:\$\{emp\.id\}`/);
		expect(activePeriodIndex).toBeGreaterThan(lockIndex);
		expect(body).not.toContain("getActiveWorkPeriod(emp.id)");
	});

	it("creates clock-in entries and work periods on the locked transaction", () => {
		const body = functionBody("clockIn");

		expect(body).toContain("createTimeEntry(");
		expect(body).toContain("timezoneCapture,\n\t\t\t\t},\n\t\t\t\ttx,");
		expect(body).toContain("await tx.insert(workPeriod)");
	});

	it("atomically creates clock-out entries, canonical records, periods, and approvals", () => {
		const body = functionBody("clockOut");

		expect(body).toContain("canonicalWorkRecordClient.createForCompletedPeriod(");
		expect(body).toContain("createClockOutApprovalRequest(");
		expect(body).toContain("db: tx");
		expect(body).toContain("notify: false");
		expect(body).toContain("eq(workPeriod.isActive, true)");
		expect(body).toContain("isNull(workPeriod.endTime)");
		expect(body).toContain("isNull(workPeriod.deletedAt)");
		expect(body).toContain(".returning({ id: workPeriod.id })");
	});

	it("validates work-category tenant access before clock-out writes", () => {
		const body = functionBody("clockOut");
		const categoryValidationIndex = body.indexOf("await validateWorkCategoryAssignment(");
		const transactionIndex = body.indexOf("await db.transaction(async (tx)");

		expect(categoryValidationIndex).toBeGreaterThanOrEqual(0);
		expect(categoryValidationIndex).toBeLessThan(transactionIndex);
	});
});
