function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Missing fixture value");
	return value;
}

import { expect, it } from "vitest";
import { assessApprovalTriage } from "../triage-assessment";
import { loadTimeCorrectionTriageEvidence } from "./time-correction-evidence";
import { facts, snapshot } from "./time-correction-evidence.test-fixture";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

const target: ApprovalInboxTriageTarget = {
	context: {
		organizationId: "org",
		requestId: "request",
		entityId: "period",
		revision: null,
		scope: "inbox",
	},
	requestKind: "time_correction",
	type: "time_entry",
	status: "pending",
	createdAt: "2026-10-18T08:00:00Z",
	priority: "normal",
	authority: "compatibility_request",
};
async function assessment(proposal = facts, smallCorrectionMinutes = 15) {
	const result = await loadTimeCorrectionTriageEvidence(target, {
		readSnapshot: async () => ({
			...snapshot,
			revision: { ...required(snapshot.revision), facts: proposal },
		}),
	});
	return assessApprovalTriage({
		requestKind: "time_correction",
		context: result.context,
		status: "pending",
		createdAt: target.createdAt,
		now: new Date("2026-10-18T09:00:00Z"),
		policy: { staleAfterHours: 72, smallCorrectionMinutes },
		evidence: [
			...result.evidence,
			{
				check: "payroll",
				payrollPeriod: { startDate: "2026-10-01", endDate: "2026-10-31" },
				state: "clear",
				validity: "current",
				context: result.context,
			},
		],
	});
}
it("uses submitted exact endpoints to qualify a safe correction at the configured boundary", async () => {
	expect(await assessment()).toMatchObject({
		riskLevel: "low",
		fastLaneGroup: "small_time_correction",
	});
});
it("preserves deletion and submitted work attribution changes above a small time delta", async () => {
	const category = {
		...facts,
		requested: {
			...facts.requested,
			workCategoryId: { kind: "set" as const, value: "new-category" },
		},
		changeMask: { ...facts.changeMask, workCategory: true },
	};
	const location = {
		...facts,
		requested: {
			...facts.requested,
			workLocationType: { kind: "set" as const, value: "remote" },
		},
		changeMask: { ...facts.changeMask, workLocation: true },
	};
	const vehicle = {
		...facts,
		requested: {
			...facts.requested,
			vehicleUse: { kind: "set" as const, value: null },
		},
		changeMask: { ...facts.changeMask, vehicleUse: true },
	};
	for (const [proposal, reason] of [
		[category, "work_category_changed"],
		[location, "work_location_changed"],
		[vehicle, "vehicle_use_changed"],
		[{ ...facts, intent: "delete" as const }, "time_entry_deleted"],
	] as const) {
		const result = await assessment(proposal);
		expect(result.riskLevel).toBe("high");
		expect(result.riskReasons).toContain(reason);
		expect(result.fastLaneGroup).toBeNull();
	}
});
it("uses captured event offsets for local-date and offset-change warnings", async () => {
	const requested = required(facts.requested.clockIn);
	const moved = {
		...facts,
		requested: {
			...facts.requested,
			clockIn: {
				...requested,
				at: "2026-10-14T23:50:00Z",
				utcOffsetMinutes: -300,
				timezone: "America/New_York",
			},
		},
	};
	const result = await assessment(moved);
	expect(result.riskLevel).toBe("high");
	expect(result.riskReasons).toEqual(
		expect.arrayContaining(["event_local_date_changed", "utc_offset_changed"]),
	);
});
it("retains a known attribution warning when endpoint capture is unavailable", async () => {
	const result = await assessment({
		...facts,
		baseline: {
			...facts.baseline,
			clockIn: { ...facts.baseline.clockIn, timezone: null },
		},
		changeMask: { ...facts.changeMask, workCategory: true },
	});
	expect(result.riskLevel).toBe("high");
	expect(result.riskReasons).toEqual(
		expect.arrayContaining(["work_category_changed", "correction_unverified"]),
	);
});
it("compares exact absolute endpoint and duration movements and honors zero", async () => {
	const requested = required(facts.requested.clockIn);
	expect(
		await assessment({
			...facts,
			requested: {
				...facts.requested,
				clockIn: { ...requested, at: "2026-10-15T07:15:00.001Z" },
			},
		}),
	).toMatchObject({ riskLevel: "medium", fastLaneGroup: null });
	expect(
		await assessment({
			...facts,
			requested: {
				...facts.requested,
				clockIn: { ...requested, at: "2026-10-15T06:45:00Z" },
			},
		}),
	).toMatchObject({ riskLevel: "low", fastLaneGroup: "small_time_correction" });
	expect(await assessment(facts, 0)).toMatchObject({
		riskLevel: "medium",
		fastLaneGroup: null,
	});
	const end = required(facts.baseline.clockOut);
	const moved = {
		...facts,
		requested: {
			...facts.requested,
			clockIn: { ...requested, at: "2026-10-15T10:00:00Z" },
			clockOut: {
				...requested,
				originalEntryId: end.entryId,
				correctionEntryId: "new-out",
				at: "2026-10-15T18:00:00Z",
			},
		},
		changeMask: { ...facts.changeMask, clockOut: true },
	};
	expect(await assessment(moved)).toMatchObject({
		riskLevel: "medium",
		fastLaneGroup: null,
	});
	const stretched = {
		...facts,
		requested: {
			...facts.requested,
			clockIn: { ...requested, at: "2026-10-15T06:45:00Z" },
			clockOut: {
				...requested,
				originalEntryId: end.entryId,
				correctionEntryId: "new-out",
				at: "2026-10-15T15:15:00Z",
			},
		},
		changeMask: { ...facts.changeMask, clockOut: true },
	};
	expect(await assessment(stretched)).toMatchObject({
		riskLevel: "medium",
		fastLaneGroup: null,
	});
});
it("does not qualify metadata-only changes or missing endpoint capture", async () => {
	expect(
		await assessment({
			...facts,
			intent: "metadata_only",
			requested: { ...facts.requested, clockIn: null },
		}),
	).toMatchObject({ riskLevel: "medium", fastLaneGroup: null });
	expect(
		await assessment({
			...facts,
			baseline: { ...facts.baseline, clockOut: null },
		}),
	).toMatchObject({
		riskLevel: "medium",
		fastLaneGroup: null,
		riskReasons: expect.arrayContaining(["correction_unverified"]),
	});
});
it("keeps unavailable, retired or foreign submitted facts unknown under either authority", async () => {
	for (const changed of [
		null,
		{ ...snapshot, revision: null },
		{ ...snapshot, organizationId: "foreign" },
		{
			...snapshot,
			comparison: {
				kind: "material_change" as const,
				changedFields: ["baseline"],
			},
		},
		{ ...snapshot, status: "approved" },
		{ ...snapshot, currentAuthority: "canonical" as const },
	]) {
		expect(
			(
				await loadTimeCorrectionTriageEvidence(target, {
					readSnapshot: async () => changed,
				})
			).evidence,
		).toMatchObject([{ state: "unknown" }]);
	}
	const canonical = { ...target, authority: "canonical_assignment" as const };
	const result = await loadTimeCorrectionTriageEvidence(canonical, {
		readSnapshot: async () => ({
			...snapshot,
			authority: "canonical_assignment",
			currentAuthority: "canonical",
		}),
	});
	expect(result.evidence).toMatchObject([
		{ state: "clear", context: { revision: "revision:fingerprint" } },
	]);
});
it("does not confuse a UTC midnight crossing with an event-local date change", async () => {
	const proposal = {
		...facts,
		baseline: {
			...facts.baseline,
			clockIn: { ...facts.baseline.clockIn, at: "2026-10-14T23:55:00Z" },
		},
		requested: {
			...facts.requested,
			clockIn: {
				...required(facts.requested.clockIn),
				at: "2026-10-15T00:05:00Z",
			},
		},
	};
	expect(await assessment(proposal)).toMatchObject({
		riskLevel: "low",
		fastLaneGroup: "small_time_correction",
	});
});
it("retains attribution, stale and payroll findings while unknown checks prevent shortcuts", async () => {
	const result = await loadTimeCorrectionTriageEvidence(target, {
		readSnapshot: async () => ({
			...snapshot,
			revision: {
				...required(snapshot.revision),
				facts: {
					...facts,
					changeMask: { ...facts.changeMask, workLocation: true },
				},
			},
		}),
	});
	const combined = assessApprovalTriage({
		requestKind: "time_correction",
		context: result.context,
		createdAt: "2026-10-15T08:00:00Z",
		now: new Date("2026-10-18T08:00:00Z"),
		status: "pending",
		policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
		evidence: [
			...result.evidence,
			{
				check: "payroll",
				state: "finding",
				validity: "current",
				context: result.context,
				reason: "payroll_blocker",
				payrollPeriod: { startDate: "2026-10-01", endDate: "2026-10-31" },
			},
		],
	});
	expect(combined).toMatchObject({
		riskLevel: "high",
		fastLaneGroup: "payroll_blocker",
	});
	expect(combined.riskReasons).toEqual(
		expect.arrayContaining([
			"payroll_blocker",
			"work_location_changed",
			"stale_pending",
		]),
	);
	const noPayroll = assessApprovalTriage({
		requestKind: "time_correction",
		context: result.context,
		createdAt: target.createdAt,
		now: new Date("2026-10-18T09:00:00Z"),
		status: "pending",
		policy: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
		evidence: (
			await loadTimeCorrectionTriageEvidence(target, {
				readSnapshot: async () => snapshot,
			})
		).evidence,
	});
	expect(noPayroll).toMatchObject({
		fastLaneGroup: null,
		riskReasons: expect.arrayContaining(["payroll_unverified"]),
	});
});
it("does not infer clear attribution from missing submitted facts", async () => {
	const incomplete = structuredClone(facts);
	Reflect.deleteProperty(incomplete.baseline.attribution, "workLocationType");
	expect(await assessment(incomplete)).toMatchObject({
		riskLevel: "medium",
		fastLaneGroup: null,
		riskReasons: expect.arrayContaining(["correction_unverified"]),
	});
});
