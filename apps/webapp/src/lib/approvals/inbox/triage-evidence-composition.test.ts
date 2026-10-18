import { beforeEach, expect, it, vi } from "vitest";
import { db } from "@/db";

const loaders = vi.hoisted(() => ({
	absence: vi.fn(),
	change: vi.fn(),
	correction: vi.fn(),
	payroll: vi.fn(),
}));
vi.mock("./absence-coverage-evidence", () => ({
	loadAbsenceCoverageTriageEvidence: loaders.absence,
}));
vi.mock("./absence-change-coverage-evidence", () => ({
	loadAbsenceChangeCoverageTriageEvidence: loaders.change,
}));
vi.mock("./time-correction-evidence", () => ({
	loadTimeCorrectionTriageEvidence: loaders.correction,
}));
vi.mock("./payroll-triage-evidence", () => ({
	loadPayrollTriageEvidence: loaders.payroll,
}));

import {
	type ApprovalInboxTriageTarget,
	loadCurrentApprovalTriageEvidence,
	resolveApprovalInboxTriage,
} from "./triage-evidence";

const target: ApprovalInboxTriageTarget = {
	context: {
		organizationId: "org",
		requestId: "request",
		entityId: "source",
		revision: null,
		scope: "submitted_request",
	},
	requestKind: "time_correction",
	type: "time_entry",
	status: "pending",
	createdAt: "2026-10-18T08:00:00Z",
	priority: "normal",
	authority: "canonical_assignment",
};
const context = { ...target.context, revision: "revision-1" };
beforeEach(() => {
	vi.resetAllMocks();
	loaders.correction.mockResolvedValue({
		context,
		evidence: [
			{
				check: "correction",
				state: "finding",
				validity: "current",
				context,
				reason: "deletion_request",
				riskLevel: "high",
			},
		],
	});
	loaders.absence.mockResolvedValue({ context, evidence: [] });
	loaders.change.mockResolvedValue({ context, evidence: [] });
	loaders.payroll.mockResolvedValue({
		context,
		evidence: [
			{ check: "payroll", state: "unknown", validity: "unverifiable", context },
		],
	});
});
it("composes correction evidence with payroll evidence bound to its current submitted revision", async () => {
	const result = await loadCurrentApprovalTriageEvidence(target);
	expect(loaders.correction).toHaveBeenCalledWith(target, {
		database: undefined,
	});
	expect(loaders.payroll).toHaveBeenCalledWith(
		{ ...target, context },
		{ database: undefined },
	);
	expect(result.evidence.map((item) => item.check)).toEqual([
		"correction",
		"payroll",
	]);
});
it("retains a known high signal when the other adapter is unavailable", async () => {
	loaders.payroll.mockRejectedValue(new Error("payroll unavailable"));
	const result = await resolveApprovalInboxTriage({
		target,
		now: new Date("2026-10-18T09:00:00Z"),
		policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
	});
	expect(result.riskLevel).toBe("high");
	expect(result.evidence).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				check: "payroll",
				state: "unknown",
				limitation: "unavailable",
			}),
		]),
	);
});
it.each(["absence", "absence_change"] as const)(
	"routes %s to its coverage owner and composes payroll",
	async (requestKind) => {
		await loadCurrentApprovalTriageEvidence({
			...target,
			requestKind,
			type:
				requestKind === "absence" ? "absence_entry" : "absence_change_request",
		});
		expect(
			requestKind === "absence" ? loaders.absence : loaders.change,
		).toHaveBeenCalledOnce();
		expect(loaders.payroll).toHaveBeenCalledOnce();
	},
);

it("uses the committing transaction for both request and revision-bound payroll evidence", async () => {
	const database = db;
	await loadCurrentApprovalTriageEvidence(target, database);
	expect(loaders.correction).toHaveBeenCalledWith(target, { database });
	expect(loaders.payroll).toHaveBeenCalledWith(
		{ ...target, context },
		{ database },
	);
});
