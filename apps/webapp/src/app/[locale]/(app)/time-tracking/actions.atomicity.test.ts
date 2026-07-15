import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	fileURLToPath(new URL("./actions/clocking.ts", import.meta.url)),
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
		expect(body).toContain(
			"action: { instant: actionInstant, ...timezoneCapture }",
		);
	});

	it("checks clock-out guards before shared writes", () => {
		const body = functionBody("clockOut");
		const projectValidationIndex = body.indexOf(
			"await validateProjectAssignment(",
		);
		const billingIndex = body.indexOf("requireBillingForMutation(");
		const approvalPolicyIndex = body.indexOf("checkClockOutNeedsApproval(");
		const managerIndex = body.indexOf(
			"await getPrimaryEligibleManagerIdForRequester({",
		);
		const canonicalIndex = body.indexOf(
			"canonicalWorkRecordClient.createForCompletedPeriod(",
		);
		const delegateIndex = body.indexOf("clockingService.clockOut({");

		expect(projectValidationIndex).toBeGreaterThanOrEqual(0);
		expect(billingIndex).toBeGreaterThan(projectValidationIndex);
		expect(approvalPolicyIndex).toBeGreaterThan(billingIndex);
		expect(managerIndex).toBeGreaterThan(approvalPolicyIndex);
		expect(canonicalIndex).toBeGreaterThan(managerIndex);
		expect(delegateIndex).toBeGreaterThan(canonicalIndex);
		expect(body).toContain("createClockOutApprovalRequest(");
	});
});
