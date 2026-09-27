import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	fileURLToPath(new URL("./actions/clocking.ts", import.meta.url)),
	"utf8",
);
const monolithicSource = readFileSync(
	fileURLToPath(new URL("./actions.ts", import.meta.url)),
	"utf8",
);

function functionBody(name: string) {
	const match = new RegExp(`export\\s+async function ${name}\\s*\\(`).exec(
		source,
	);
	const start = match?.index ?? -1;
	expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
	const nextExport = source.indexOf("export async function", start + 1);
	return source.slice(start, nextExport === -1 ? undefined : nextExport);
}

describe("clocking service delegation", () => {
	it("runs clockIn as a command of the Clocking module", () => {
		// The web action authenticates, then runs the live adapter bots share (#277).
		expect(functionBody("clockIn")).toContain("await clockInAs(");
		const body = functionBody("clockInAs");

		expect(body).toContain("await clocking.run({");
		expect(body).not.toContain("clockingService");
		expect(body).not.toContain("db.transaction");
	});

	it("runs clockOut as a command of the Clocking module", () => {
		expect(functionBody("clockOut")).toContain("await clockOutAs(");
		const body = functionBody("clockOutAs");

		expect(body).toContain("await clocking.run({");
		expect(body).not.toContain("clockingService");
		expect(body).not.toContain("db.transaction");
	});

	it("creates manual source and approval state in one workflow transaction", () => {
		const body = functionBody("createManualTimeEntry");

		expect(body).toContain("runtime.repository.withTransaction(");
		expect(body).toContain("executeOrdinaryWorkPeriodSubmissionInTransaction(");
		expect(body).not.toContain("await db.transaction(");
		expect(body).not.toContain("createManualEntryApprovalRequest(");
		expect(body).toContain(
			"eq(workPeriod.organizationId, targetEmployee.organizationId)",
		);
		const categoryGuard = body.indexOf("validateWorkCategoryAssignment(");
		const replayTransaction = body.indexOf(
			"runtime.repository.withTransaction(",
		);
		const creationTransaction = body.lastIndexOf(
			"runtime.repository.withTransaction(",
		);
		expect(categoryGuard).toBeGreaterThanOrEqual(0);
		expect(replayTransaction).toBeLessThan(categoryGuard);
		expect(categoryGuard).toBeLessThan(creationTransaction);
	});

	it("keeps the monolithic action as an authenticated billing-guarded delegate", () => {
		const start = monolithicSource.indexOf(
			"export async function createManualTimeEntry(",
		);
		const end = monolithicSource.indexOf("export async function", start + 1);
		const body = monolithicSource.slice(start, end);

		expect(body).toContain("getRequestSession()");
		expect(body).toContain("requireBillingForMutation(");
		expect(body).toContain("createManualTimeEntryModular(data)");
		expect(body).not.toContain("createTimeEntry(");
		expect(body).not.toContain("createManualEntryApprovalRequest(");
	});
});
