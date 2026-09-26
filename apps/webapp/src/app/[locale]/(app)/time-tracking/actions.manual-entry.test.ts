import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	fileURLToPath(new URL("./actions.ts", import.meta.url)),
	"utf8",
);

function manualActionBody() {
	const start = source.indexOf("export async function createManualTimeEntry(");
	const end = source.indexOf("export async function", start + 1);
	expect(start).toBeGreaterThanOrEqual(0);
	return source.slice(start, end);
}

describe("monolithic manual time entry action", () => {
	it("preserves authentication and billing snapshots before delegation", () => {
		const body = manualActionBody();
		const auth = body.indexOf("auth.api.getSession(");
		const employee = body.indexOf("getCurrentEmployee()");
		const billing = body.indexOf(
			"requireBillingForMutation(emp.organizationId)",
		);
		const delegation = body.indexOf("createManualTimeEntryModular(data)");

		expect(auth).toBeGreaterThanOrEqual(0);
		expect(employee).toBeGreaterThan(auth);
		expect(billing).toBeGreaterThan(employee);
		expect(delegation).toBeGreaterThan(billing);
		expect(body).toContain(
			'{ success: false, error: "Not authenticated", code: MANUAL_ENTRY_NOT_AUTHENTICATED }',
		);
		expect(body).toContain('error: "Employee profile not found",');
		// A frozen command's retry is refused for another session before billing (#310).
		const contextCheck = body.indexOf("recoveryContext.userId !== session.user.id");
		expect(contextCheck).toBeGreaterThan(employee);
		expect(billing).toBeGreaterThan(contextCheck);
		expect(body).toContain('error: "billing_required"');
	});

	it("contains no second source or approval implementation", () => {
		const body = manualActionBody();

		expect(body).not.toContain("createTimeEntry(");
		expect(body).not.toContain("canonicalWorkRecordClient");
		expect(body).not.toContain("createManualEntryApprovalRequest");
		expect(body).not.toContain("db.transaction(");
	});
});
