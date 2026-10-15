import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { planDeletion } from "./delete-plan";
import type { WorkRecordPair } from "./plan";
import { recordAgreement } from "./record-agreement";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const MARKER = parseInstant("2026-03-02T16:00:00Z");

function agreeingPair(): WorkRecordPair {
	const startTime = new Date("2026-03-02T07:00:00.000Z");
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
			approvalStatus: "approved",
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
				approvalState: "approved",
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

describe("planDeletion (#1227)", () => {
	it("shrinks both records to a zero-length sentinel at the markers, in agreement", () => {
		const plan = planDeletion(agreeingPair(), { clockInAt: MARKER, clockOutAt: MARKER });

		if (plan.kind !== "delete") throw new Error(`not planned: ${plan.kind}`);
		expect(plan.sentinel.period).toMatchObject({
			startTime: new Date("2026-03-02T16:00:00.000Z"),
			endTime: new Date("2026-03-02T16:00:00.000Z"),
			durationMinutes: 0,
			approvalStatus: "approved",
			projectId: PROJECT,
		});
		expect(plan.sentinel.canonical.record).toMatchObject({ durationMinutes: 0 });
		expect(recordAgreement(plan.sentinel.period, plan.sentinel.canonical).agrees).toBe(true);
	});

	it("refuses markers at two instants", () => {
		expect(
			planDeletion(agreeingPair(), {
				clockInAt: MARKER,
				clockOutAt: parseInstant("2026-03-02T16:00:01Z"),
			}),
		).toEqual({ kind: "interval_invalid" });
	});

	it("refuses live work, work without a canonical record and a divergent pair", () => {
		const pair = agreeingPair();
		const markers = { clockInAt: MARKER, clockOutAt: MARKER };

		expect(planDeletion({ ...pair, period: { ...pair.period, endTime: null } }, markers)).toEqual({
			kind: "work_running",
		});
		expect(planDeletion({ ...pair, canonical: null }, markers)).toEqual({
			kind: "canonical_record_missing",
		});
		const drifted: WorkRecordPair = {
			...pair,
			canonical: pair.canonical && {
				...pair.canonical,
				record: { ...pair.canonical.record, durationMinutes: 511 },
			},
		};
		expect(planDeletion(drifted, markers)).toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["duration"],
		});
		expect(planDeletion(drifted, { ...markers, toleratedDrift: ["duration"] })).toMatchObject({
			kind: "delete",
		});
	});
});
