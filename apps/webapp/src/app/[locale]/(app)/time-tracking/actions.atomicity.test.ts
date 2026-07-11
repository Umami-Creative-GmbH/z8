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

describe("clocking service delegation", () => {
	it.each([
		"clockIn",
		"clockOut",
	])("delegates %s writes to the shared clocking service", (name) => {
		const body = functionBody(name);

		expect(body).toContain(`clockingService.${name}({`);
		expect(body).not.toContain("await db.transaction(async (tx)");
		expect(body).not.toContain("pg_advisory_xact_lock");
	});

	it("captures browser evidence before delegating clock-in", () => {
		const body = functionBody("clockIn");

		const captureIndex = body.indexOf("resolveTimeEntryTimezoneCapture(");
		const delegateIndex = body.indexOf("clockingService.clockIn({");

		expect(captureIndex).toBeGreaterThanOrEqual(0);
		expect(delegateIndex).toBeGreaterThan(captureIndex);
		expect(body).toContain("action: { instant: instantFromDate(now), ...timezoneCapture }");
	});

	it("checks clock-out guards before shared writes", () => {
		const body = functionBody("clockOut");
		const projectValidationIndex = body.indexOf("await validateProjectAssignment(");
		const approvalPolicyIndex = body.indexOf("policyService.checkClockOutNeedsApproval(emp.id)");
		const billingIndex = body.indexOf("await requireBillingForMutation(emp.organizationId)");
		const managerIndex = body.indexOf("await resolveTimeApprovalManagerId(");
		const delegateIndex = body.indexOf("clockingService.clockOut({");

		expect(projectValidationIndex).toBeGreaterThanOrEqual(0);
		expect(approvalPolicyIndex).toBeGreaterThan(projectValidationIndex);
		expect(billingIndex).toBeGreaterThan(approvalPolicyIndex);
		expect(managerIndex).toBeGreaterThan(billingIndex);
		expect(delegateIndex).toBeGreaterThan(managerIndex);
		expect(body).toContain("canonicalWorkRecordClient.createForCompletedPeriod(");
		expect(body).toContain("createClockOutApprovalRequest(");
	});
});
