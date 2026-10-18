function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined)
		throw new Error("Missing fixture value");
	return value;
}

import { describe, expect, it } from "vitest";
import { loadAbsenceCoverageTriageEvidence } from "./absence-coverage-evidence";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

const target: ApprovalInboxTriageTarget = {
	context: {
		organizationId: "org",
		requestId: "request",
		entityId: "absence",
		revision: null,
		scope: "inbox",
	},
	requestKind: "absence",
	type: "absence_entry",
	status: "pending",
	createdAt: "2026-10-18T08:00:00Z",
	priority: "normal",
	authority: "compatibility_request",
};
describe("current absence coverage evidence", () => {
	it("reports unavailable source facts as unknown without denying manual review", async () => {
		const result = await loadAbsenceCoverageTriageEvidence(target, {
			readSnapshot: async () => null,
		});
		expect(result.evidence).toMatchObject([
			{ check: "coverage", state: "unknown", validity: "unverifiable" },
		]);
		expect(result.context).toEqual(target.context);
	});
});
it("binds a clear full-day calculation to the submitted revision and rejects changed source facts", async () => {
	const { snapshot } = await import("./absence-coverage-evidence.test-fixture");
	const result = await loadAbsenceCoverageTriageEvidence(target, {
		readSnapshot: async () => snapshot,
	});
	expect(result.context.revision).toBe("revision:fingerprint");
	expect(result.evidence).toMatchObject([
		{
			check: "coverage",
			state: "clear",
			validity: "current",
			context: { revision: "revision:fingerprint" },
		},
	]);
	const changed = await loadAbsenceCoverageTriageEvidence(target, {
		readSnapshot: async () => ({
			...snapshot,
			live: { ...snapshot.live, endDate: "2026-10-20" },
		}),
	});
	expect(changed.evidence).toMatchObject([
		{ state: "unknown", validity: "stale" },
	]);
});
it("rejects cross-organization, mismatched identity, missing revision and retired authority snapshots", async () => {
	const { snapshot } = await import("./absence-coverage-evidence.test-fixture");
	for (const changed of [
		{ ...snapshot, organizationId: "foreign" },
		{ ...snapshot, requestId: "other" },
		{ ...snapshot, revision: null },
		{ ...snapshot, currentAuthority: "canonical" as const },
		{ ...snapshot, status: "obsolete" },
	]) {
		const result = await loadAbsenceCoverageTriageEvidence(target, {
			readSnapshot: async () => changed,
		});
		expect(result.evidence[0]?.state).toBe("unknown");
	}
});
it("keeps canonical coverage findings and unknown gaps together in the shared assessment", async () => {
	const { snapshot } = await import("./absence-coverage-evidence.test-fixture");
	const canonical = { ...target, authority: "canonical_assignment" as const };
	const result = await loadAbsenceCoverageTriageEvidence(canonical, {
		readSnapshot: async () => ({
			...snapshot,
			authority: "canonical_assignment",
			currentAuthority: "canonical",
			shifts: snapshot.shifts.slice(0, 1),
			rules: [{ ...required(snapshot.rules[0]), endTime: "12:00" }],
		}),
	});
	const { assessApprovalTriage } = await import("../triage-assessment");
	const assessment = assessApprovalTriage({
		requestKind: "absence",
		context: result.context,
		evidence: result.evidence,
		status: "pending",
		createdAt: target.createdAt,
		now: new Date("2026-10-18T09:00:00Z"),
		policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
	});
	expect(assessment).toMatchObject({ riskLevel: "high", fastLaneGroup: null });
	expect(assessment.riskReasons).toEqual(
		expect.arrayContaining([
			"staffing_shortfall",
			"coverage_unverified",
			"payroll_unverified",
		]),
	);
	expect(
		assessment.reasons.find((reason) => reason.code === "staffing_shortfall")
			?.text.params,
	).toMatchObject({ startTime: "09:00", endTime: "12:00", staffCount: 0 });
});
it("treats unavailable or invalid organization timezone as unverified", async () => {
	const { snapshot } = await import("./absence-coverage-evidence.test-fixture");
	for (const timezone of [null, "Not/AZone"])
		expect(
			(
				await loadAbsenceCoverageTriageEvidence(target, {
					readSnapshot: async () => ({ ...snapshot, timezone }),
				})
			).evidence,
		).toMatchObject([{ state: "unknown" }]);
});
it("includes the affected staffing area's readable name in the explanation", async () => {
	const { snapshot } = await import("./absence-coverage-evidence.test-fixture");
	const result = await loadAbsenceCoverageTriageEvidence(target, {
		readSnapshot: async () => ({
			...snapshot,
			shifts: snapshot.shifts.slice(0, 1),
			rules: snapshot.rules.map((rule) => ({
				...rule,
				subareaName: "Front desk",
			})),
		}),
	});
	expect(result.evidence[0]?.text?.params).toMatchObject({
		subareaName: "Front desk",
		staffCount: 0,
	});
});
