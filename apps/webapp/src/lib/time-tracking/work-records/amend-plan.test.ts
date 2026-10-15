import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { planChange, type WorkRecordPair } from "./plan";
import { recordAgreement } from "./record-agreement";

const PROJECT = "00000000-0000-4000-8000-000000000001";

/** 07:00:20 to 15:30:00 UTC on a project, pending approval in both records. */
function pendingPair(): WorkRecordPair {
	const startTime = new Date("2026-03-02T07:00:20.000Z");
	const endTime = new Date("2026-03-02T15:30:00.000Z");
	const attribution = {
		workCategoryId: null,
		workLocationType: "office" as const,
		vehicleKind: null,
		vehicleId: null,
		odometerStartKm: null,
		odometerEndKm: null,
		drivenDistanceKm: null,
	};
	return {
		period: {
			startTime,
			endTime,
			durationMinutes: 510,
			approvalStatus: "pending",
			projectId: PROJECT,
			taskId: null,
			isBillable: false,
			...attribution,
		},
		canonical: {
			record: {
				startAt: startTime,
				endAt: endTime,
				durationMinutes: 510,
				approvalState: "pending",
			},
			detail: attribution,
			allocations: [
				{
					allocationKind: "project",
					projectId: PROJECT,
					taskId: null,
					costCenterId: null,
					weightPercent: 100,
					isBillable: false,
				},
			],
		},
	};
}

describe("planChange: amend the approval state (#1227)", () => {
	it.each(["approved", "rejected"] as const)(
		"decides %s on both records, keeping times, minutes and attribution",
		(decision) => {
			const plan = planChange(pendingPair(), { kind: "amend", approval: decision }, "half_up");

			if (plan.kind !== "amend") throw new Error(`not planned: ${plan.kind}`);
			expect(plan.changes).toEqual({
				clockIn: false,
				clockOut: false,
				attribution: [],
				approval: true,
			});
			expect(plan.result.period).toMatchObject({
				approvalStatus: decision,
				durationMinutes: 510,
				projectId: PROJECT,
			});
			expect(plan.result.canonical.record.approvalState).toBe(decision);
			expect(recordAgreement(plan.result.period, plan.result.canonical).agrees).toBe(true);
		},
	);

	it("refuses a decision the pair already holds, with nothing else, as unchanged", () => {
		const pair = pendingPair();
		const approved: WorkRecordPair = {
			period: { ...pair.period, approvalStatus: "approved" },
			canonical: pair.canonical && {
				...pair.canonical,
				record: { ...pair.canonical.record, approvalState: "approved" },
			},
		};

		expect(planChange(approved, { kind: "amend", approval: "approved" }, "half_up")).toEqual({
			kind: "unchanged",
		});
	});

	it("decides together with new times in one plan", () => {
		const plan = planChange(
			pendingPair(),
			{
				kind: "amend",
				times: { clockIn: { at: parseInstant("2026-03-02T08:00:00Z") } },
				approval: "approved",
			},
			"half_up",
		);

		if (plan.kind !== "amend") throw new Error(`not planned: ${plan.kind}`);
		expect(plan.changes).toMatchObject({ clockIn: true, approval: true });
		expect(plan.result.period).toMatchObject({ approvalStatus: "approved", durationMinutes: 450 });
	});
});

describe("planChange: amend over tolerated drift (#1227, removed by #1229)", () => {
	function drifted(): WorkRecordPair {
		const pair = pendingPair();
		return {
			period: pair.period,
			canonical: pair.canonical && {
				...pair.canonical,
				record: {
					...pair.canonical.record,
					endAt: new Date("2026-03-02T17:30:00.000Z"),
					durationMinutes: 630,
				},
			},
		};
	}

	it("refuses a drifted pair unless the change tolerates the drift", () => {
		expect(planChange(drifted(), { kind: "amend", approval: "approved" }, "half_up")).toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["interval", "duration"],
		});
		expect(
			planChange(
				drifted(),
				{ kind: "amend", approval: "approved", toleratedDrift: ["duration"] },
				"half_up",
			),
		).toEqual({ kind: "canonical_divergence", found: "locked_pair", disagreements: ["interval"] });
	});

	it("rewrites the tolerated facets of the record from the work period", () => {
		const plan = planChange(
			drifted(),
			{ kind: "amend", approval: "approved", toleratedDrift: ["interval", "duration"] },
			"half_up",
		);

		if (plan.kind !== "amend") throw new Error(`not planned: ${plan.kind}`);
		expect(plan.result.canonical.record).toMatchObject({
			endAt: new Date("2026-03-02T15:30:00.000Z"),
			durationMinutes: 510,
		});
		expect(recordAgreement(plan.result.period, plan.result.canonical).agrees).toBe(true);
	});

	it("never tolerates drift of anything else", () => {
		const pair = pendingPair();
		const divergent: WorkRecordPair = {
			period: { ...pair.period, workLocationType: "home" },
			canonical: pair.canonical,
		};

		expect(
			planChange(
				divergent,
				{ kind: "amend", approval: "approved", toleratedDrift: ["interval", "duration"] },
				"half_up",
			),
		).toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["work_location"],
		});
	});
});

describe("planChange: amend to an adopted endpoint (#1227)", () => {
	it("moves an endpoint to an adopted recorded correction even at the same instant", () => {
		const plan = planChange(
			pendingPair(),
			{
				kind: "amend",
				times: { clockOut: { at: parseInstant("2026-03-02T15:30:00Z"), adopted: true } },
			},
			"floor",
		);

		if (plan.kind !== "amend") throw new Error(`not planned: ${plan.kind}`);
		expect(plan.changes).toMatchObject({ clockIn: false, clockOut: true });
		expect(plan.result.durationMinutes).toBe(509);
	});
});
