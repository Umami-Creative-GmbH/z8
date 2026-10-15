import { describe, expect, it } from "vitest";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import type { WorkRecordPair } from "./plan";
import { planOwedBreakDivision } from "./plan-owed-break";
import { recordAgreement } from "./record-agreement";

const VEHICLE = "00000000-0000-4000-8000-000000000004";
const REGULATION = {
	id: "00000000-0000-4000-8000-000000000001",
	name: "ArbZG",
	maxUninterruptedMinutes: null,
	breakRules: [
		{ workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
		{ workingMinutesThreshold: 540, requiredBreakMinutes: 45 },
	],
};

/** 06:00:40 to 13:00:31 UTC (420 stored minutes), driving a van with complete readings. */
function agreeingPair(
	vehicle: { start: number | null; end: number | null; distance: number | null } = {
		start: 100,
		end: 180,
		distance: 80,
	},
): WorkRecordPair {
	const startTime = new Date("2026-07-22T06:00:40.000Z");
	const endTime = new Date("2026-07-22T13:00:31.000Z");
	const vehicleColumns = {
		vehicleKind: "organization" as const,
		vehicleId: VEHICLE,
		odometerStartKm: vehicle.start,
		odometerEndKm: vehicle.end,
		drivenDistanceKm: vehicle.distance,
	};
	return {
		period: {
			startTime,
			endTime,
			durationMinutes: 420,
			approvalStatus: "approved",
			projectId: null,
			taskId: null,
			isBillable: false,
			workCategoryId: null,
			workLocationType: "office",
			...vehicleColumns,
		},
		canonical: {
			record: {
				startAt: startTime,
				endAt: endTime,
				durationMinutes: 420,
				approvalState: "approved",
			},
			detail: { workCategoryId: null, workLocationType: "office", ...vehicleColumns },
			allocations: [],
		},
	};
}

const owed = (alreadyTakenBreakMinutes = 0) => ({
	regulation: REGULATION,
	alreadyTakenBreakMinutes,
});

describe("planOwedBreakDivision", () => {
	it("places the owed break after the threshold and rounds each half in the admission's arithmetic", () => {
		const halfUp = planOwedBreakDivision(agreeingPair(), owed(10), "half_up");
		const floor = planOwedBreakDivision(agreeingPair(), owed(10), "floor");

		if (halfUp.kind !== "divide_owed_break" || floor.kind !== "divide_owed_break") {
			throw new Error(`not planned: ${halfUp.kind}, ${floor.kind}`);
		}
		expect(halfUp.owedBreak).toMatchObject({
			breakMinutes: 20,
			alreadyTakenBreakMinutes: 10,
			rule: { workingMinutesThreshold: 360, requiredBreakMinutes: 30 },
			regulation: { id: REGULATION.id, name: "ArbZG" },
		});
		expect(instantToCanonicalString(halfUp.owedBreak.startAt)).toBe("2026-07-22T12:00:40Z");
		expect(instantToCanonicalString(halfUp.owedBreak.endAt)).toBe("2026-07-22T12:20:40Z");
		// 06:00:40-12:00:40 is 360 minutes; 12:20:40-13:00:31 is 39m51s.
		expect([halfUp.retained.durationMinutes, halfUp.generated.durationMinutes]).toEqual([360, 40]);
		expect([floor.retained.durationMinutes, floor.generated.durationMinutes]).toEqual([360, 39]);
		expect(halfUp.retained.period.endTime).toEqual(new Date("2026-07-22T12:00:40.000Z"));
		expect(halfUp.generated.period.startTime).toEqual(new Date("2026-07-22T12:20:40.000Z"));
		for (const half of [halfUp.retained, halfUp.generated]) {
			expect(recordAgreement(half.period, half.canonical).agrees).toBe(true);
		}
	});

	it("keeps a positive half that rounds to zero minutes", () => {
		const pair = agreeingPair();
		if (!pair.canonical) throw new Error("no canonical record");
		// 06:00:40 to 12:31:00: the break ends 20 seconds before the work does.
		const endTime = new Date("2026-07-22T12:31:00.000Z");
		pair.period.endTime = endTime;
		pair.period.durationMinutes = 390;
		pair.canonical.record.endAt = endTime;
		pair.canonical.record.durationMinutes = 390;

		const plan = planOwedBreakDivision(pair, owed(), "half_up");

		if (plan.kind !== "divide_owed_break") throw new Error(plan.kind);
		expect([plan.retained.durationMinutes, plan.generated.durationMinutes]).toEqual([360, 0]);
	});

	it("is not required without a regulation, below every threshold or once the break was taken", () => {
		expect(
			planOwedBreakDivision(
				agreeingPair(),
				{ regulation: null, alreadyTakenBreakMinutes: 0 },
				"half_up",
			),
		).toEqual({ kind: "not_required" });
		expect(planOwedBreakDivision(agreeingPair(), owed(30), "half_up")).toEqual({
			kind: "not_required",
		});
	});

	it("keeps complete readings on the retained half and gives the resumed half 0 km", () => {
		const plan = planOwedBreakDivision(agreeingPair(), owed(), "half_up");
		if (plan.kind !== "divide_owed_break") throw new Error(plan.kind);

		expect(plan.retained.attribution.vehicleUse).toMatchObject({
			startKm: 100,
			endKm: 180,
			distanceKm: 80,
		});
		expect(plan.generated.attribution.vehicleUse).toMatchObject({
			startKm: null,
			endKm: null,
			distanceKm: 0,
		});
	});

	it("keeps vehicle use awaiting its end reading on the half that ends at the clock-out", () => {
		const plan = planOwedBreakDivision(
			agreeingPair({ start: 100, end: null, distance: null }),
			owed(),
			"half_up",
		);
		if (plan.kind !== "divide_owed_break") throw new Error(plan.kind);

		expect(plan.retained.attribution.vehicleUse).toMatchObject({ distanceKm: 0 });
		expect(plan.generated.attribution.vehicleUse).toMatchObject({ startKm: 100, endKm: null });
	});

	it("refuses a pair that disagrees before deciding whether a break is owed", () => {
		const pair = agreeingPair();
		if (!pair.canonical) throw new Error("no canonical record");
		pair.canonical.detail.workLocationType = "home";

		expect(
			planOwedBreakDivision(pair, { regulation: null, alreadyTakenBreakMinutes: 0 }, "half_up"),
		).toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["work_location"],
		});
	});
});
