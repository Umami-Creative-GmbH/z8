import { describe, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { type PlannableChange, planChange as planIn, type WorkRecordPair } from "./plan";
import { recordAgreement } from "./record-agreement";

/** Append admission's arithmetic unless a test names legacy admission's. */
const planChange = (pair: WorkRecordPair, change: PlannableChange) =>
	planIn(pair, change, "half_up");

const PROJECT = "00000000-0000-4000-8000-000000000001";
const TASK = "00000000-0000-4000-8000-000000000002";
const CATEGORY = "00000000-0000-4000-8000-000000000003";
const VEHICLE = "00000000-0000-4000-8000-000000000004";
const COST_CENTER = "00000000-0000-4000-8000-000000000005";
const OTHER_PROJECT = "00000000-0000-4000-8000-000000000006";

const costCentre = {
	allocationKind: "cost_center" as const,
	projectId: null,
	taskId: null,
	costCenterId: COST_CENTER,
	weightPercent: 30,
	isBillable: false,
};

/** 07:00:20 to 15:30:00 UTC on a project with a task, a cost centre and a van with readings. */
function agreeingPair(): WorkRecordPair {
	const startTime = new Date("2026-03-02T07:00:20.000Z");
	const endTime = new Date("2026-03-02T15:30:00.000Z");
	return {
		period: {
			startTime,
			endTime,
			durationMinutes: 510,
			approvalStatus: "approved",
			projectId: PROJECT,
			taskId: TASK,
			isBillable: true,
			workCategoryId: CATEGORY,
			workLocationType: "office",
			vehicleKind: "organization",
			vehicleId: VEHICLE,
			odometerStartKm: 100,
			odometerEndKm: 180,
			drivenDistanceKm: 80,
		},
		canonical: {
			record: {
				startAt: startTime,
				endAt: endTime,
				durationMinutes: 510,
				approvalState: "approved",
			},
			detail: {
				workCategoryId: CATEGORY,
				workLocationType: "office",
				vehicleKind: "organization",
				vehicleId: VEHICLE,
				odometerStartKm: 100,
				odometerEndKm: 180,
				drivenDistanceKm: 80,
			},
			allocations: [
				costCentre,
				{
					allocationKind: "project",
					projectId: PROJECT,
					taskId: TASK,
					costCenterId: null,
					weightPercent: 100,
					isBillable: true,
				},
			],
		},
	};
}

const divide = (at: Instant, rest: { odometerKm?: number | null } = {}) => ({
	kind: "divide" as const,
	at,
	...rest,
});

describe("planChange: divide at an instant", () => {
	it("divides an agreeing pair into two agreeing halves that each round their own minutes", () => {
		const plan = planChange(agreeingPair(), divide(parseInstant("2026-03-02T11:00:00Z")));

		expect(plan.kind).toBe("divide");
		if (plan.kind !== "divide") return;
		// 3h59m40s rounds half up to 240; 4h30m is 270.
		expect(plan.retained.period).toMatchObject({
			startTime: new Date("2026-03-02T07:00:20.000Z"),
			endTime: new Date("2026-03-02T11:00:00.000Z"),
			durationMinutes: 240,
			approvalStatus: "approved",
			projectId: PROJECT,
			taskId: TASK,
			isBillable: true,
		});
		expect(plan.generated.period).toMatchObject({
			startTime: new Date("2026-03-02T11:00:00.000Z"),
			endTime: new Date("2026-03-02T15:30:00.000Z"),
			durationMinutes: 270,
			approvalStatus: "approved",
		});
		// Both halves keep the cost centre and book the project as one whole allocation.
		for (const half of [plan.retained, plan.generated]) {
			expect(recordAgreement(half.period, half.canonical)).toEqual({
				agrees: true,
				disagreements: [],
			});
			expect(half.canonical.allocations).toEqual([
				costCentre,
				expect.objectContaining({ allocationKind: "project", projectId: PROJECT, taskId: TASK }),
			]);
		}
	});

	it("keeps a positive half that rounds to zero minutes", () => {
		// 07:00:20 to 07:00:40 is 20 seconds.
		const plan = planChange(agreeingPair(), divide(parseInstant("2026-03-02T07:00:40Z")));

		if (plan.kind !== "divide") throw new Error(`not planned: ${plan.kind}`);
		expect([plan.retained.durationMinutes, plan.generated.durationMinutes]).toEqual([0, 509]);
	});

	it("floors each half's own minutes with legacy admission's arithmetic", () => {
		// 07:00:20 to 11:00:00 is 3h59m40s; 11:00:00 to 15:29:50 is 4h29m50s.
		const pair = agreeingPair();
		const endTime = new Date("2026-03-02T15:29:50.000Z");
		const shortened: WorkRecordPair = {
			period: { ...pair.period, endTime },
			canonical: pair.canonical && {
				...pair.canonical,
				record: { ...pair.canonical.record, endAt: endTime },
			},
		};

		const plan = planIn(shortened, divide(parseInstant("2026-03-02T11:00:00Z")), "floor");

		if (plan.kind !== "divide") throw new Error(`not planned: ${plan.kind}`);
		expect([plan.retained.durationMinutes, plan.generated.durationMinutes]).toEqual([239, 269]);
		for (const half of [plan.retained, plan.generated]) {
			expect(half.canonical.record.durationMinutes).toBe(half.period.durationMinutes);
			expect(recordAgreement(half.period, half.canonical).agrees).toBe(true);
		}
	});

	it("refuses a locked pair that disagrees, naming the facets, before planning anything", () => {
		const pair = agreeingPair();
		const disagreeing: WorkRecordPair = {
			...pair,
			canonical: pair.canonical && {
				...pair.canonical,
				record: { ...pair.canonical.record, durationMinutes: 509 },
				detail: { ...pair.canonical.detail, workLocationType: "home" },
			},
		};

		expect(planChange(disagreeing, divide(parseInstant("2026-03-02T11:00:00Z")))).toEqual({
			kind: "canonical_divergence",
			found: "locked_pair",
			disagreements: ["duration", "work_location"],
		});
	});

	it("refuses work without a canonical work record and live work", () => {
		const pair = agreeingPair();
		const at = parseInstant("2026-03-02T11:00:00Z");

		expect(planChange({ ...pair, canonical: null }, divide(at))).toEqual({
			kind: "canonical_record_missing",
		});
		expect(planChange({ ...pair, period: { ...pair.period, endTime: null } }, divide(at))).toEqual({
			kind: "work_running",
		});
	});

	it.each([
		["at the start", "2026-03-02T07:00:20Z"],
		["at the end", "2026-03-02T15:30:00Z"],
		["before the work", "2026-03-02T06:00:00Z"],
		["after the work", "2026-03-02T16:00:00Z"],
	])("refuses an instant %s", (_label, at) => {
		expect(planChange(agreeingPair(), divide(parseInstant(at)))).toEqual({
			kind: "instant_outside_work",
		});
	});

	it("divides the readings at the instant's odometer reading, or leaves both cut readings missing", () => {
		const at = parseInstant("2026-03-02T11:00:00Z");
		const read = planChange(agreeingPair(), divide(at, { odometerKm: 140 }));
		const skipped = planChange(agreeingPair(), divide(at));

		if (read.kind !== "divide" || skipped.kind !== "divide") throw new Error("not planned");
		expect([read.retained.period, read.generated.period]).toMatchObject([
			{ odometerStartKm: 100, odometerEndKm: 140, drivenDistanceKm: 40 },
			{ odometerStartKm: 140, odometerEndKm: 180, drivenDistanceKm: 40 },
		]);
		expect([skipped.retained.canonical.detail, skipped.generated.canonical.detail]).toMatchObject([
			{ vehicleId: VEHICLE, odometerStartKm: 100, odometerEndKm: null, drivenDistanceKm: null },
			{ vehicleId: VEHICLE, odometerStartKm: null, odometerEndKm: 180, drivenDistanceKm: null },
		]);
	});

	it("refuses an odometer reading outside the work's readings", () => {
		expect(
			planChange(agreeingPair(), divide(parseInstant("2026-03-02T11:00:00Z"), { odometerKm: 200 })),
		).toEqual({ kind: "vehicle_use_refused", code: "split_value_out_of_range" });
	});

	it("applies an attribution override to the named half only", () => {
		const plan = planChange(agreeingPair(), {
			...divide(parseInstant("2026-03-02T11:00:00Z")),
			attribution: {
				half: "generated",
				patch: { project: { projectId: OTHER_PROJECT, billableDefault: false }, vehicleUse: null },
			},
		});

		if (plan.kind !== "divide") throw new Error("not planned");
		expect(plan.retained.attribution.project).toEqual({
			projectId: PROJECT,
			taskId: TASK,
			billable: true,
		});
		// The task follows the project and the new project's default applies.
		expect(plan.generated.attribution.project).toEqual({
			projectId: OTHER_PROJECT,
			taskId: null,
			billable: false,
		});
		expect(plan.generated.attribution.vehicleUse).toBeNull();
		expect(recordAgreement(plan.generated.period, plan.generated.canonical).agrees).toBe(true);
	});

	it("refuses an override that cannot be represented", () => {
		expect(
			planChange(agreeingPair(), {
				...divide(parseInstant("2026-03-02T11:00:00Z")),
				attribution: { half: "retained", patch: { project: null, billable: true } },
			}),
		).toEqual({ kind: "attribution_unrepresentable", reason: "billable_without_project" });
	});
});

/** Small deterministic PRNG (mulberry32), so a failing sequence reproduces from its seed. */
function random(seed: number) {
	let state = seed >>> 0;
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
		pick: <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T,
	};
}

type Vehicle = { start: number | null; end: number | null; distance: number | null } | null;

function generatedPair(rng: ReturnType<typeof random>): WorkRecordPair {
	const startMs = Date.parse("2026-03-02T00:00:00Z") + rng.int(0, 86_400_000);
	const endMs = startMs + rng.int(2, 14 * 3_600_000);
	const startTime = new Date(startMs);
	const endTime = new Date(endMs);
	const durationMinutes = Math.round((endMs - startMs) / 60_000);
	const projectId = rng.pick([null, PROJECT]);
	const taskId = projectId ? rng.pick([null, TASK]) : null;
	const isBillable = projectId ? rng.pick([false, true]) : false;
	const workCategoryId = rng.pick([null, CATEGORY]);
	const workLocationType = rng.pick([null, "office", "home", "remote", "other"] as const);
	const startKm = rng.int(0, 50_000);
	const vehicle: Vehicle = rng.pick<Vehicle>([
		null,
		{ start: startKm, end: startKm + rng.int(0, 400), distance: null },
		{ start: null, end: null, distance: rng.int(0, 400) },
		{ start: startKm, end: null, distance: null },
	]);
	const vehicleColumns = vehicle
		? {
				vehicleKind: "organization" as const,
				vehicleId: VEHICLE,
				odometerStartKm: vehicle.start,
				odometerEndKm: vehicle.end,
				drivenDistanceKm:
					vehicle.start !== null && vehicle.end !== null
						? vehicle.end - vehicle.start
						: vehicle.distance,
			}
		: {
				vehicleKind: null,
				vehicleId: null,
				odometerStartKm: null,
				odometerEndKm: null,
				drivenDistanceKm: null,
			};
	const approval = rng.pick(["approved", "rejected", "pending"] as const);
	return {
		period: {
			startTime,
			endTime,
			durationMinutes,
			approvalStatus: approval,
			projectId,
			taskId,
			isBillable,
			workCategoryId,
			workLocationType,
			...vehicleColumns,
		},
		canonical: {
			record: { startAt: startTime, endAt: endTime, durationMinutes, approvalState: approval },
			detail: { workCategoryId, workLocationType, ...vehicleColumns },
			allocations: [
				...(rng.pick([false, true]) ? [costCentre] : []),
				...(projectId
					? [
							{
								allocationKind: "project" as const,
								projectId,
								taskId,
								costCenterId: null,
								weightPercent: 100,
								isBillable,
							},
						]
					: []),
			],
		},
	};
}

describe("planChange over generated divide chains", () => {
	it.each(Array.from({ length: 40 }, (_, index) => index + 1))(
		"keeps every half in record agreement and the work tiled (seed %i)",
		(seed) => {
			const rng = random(seed);
			const source = generatedPair(rng);
			let segments: WorkRecordPair[] = [source];
			for (let step = 0; step < 6; step++) {
				const index = rng.int(0, segments.length - 1);
				const target = segments[index] as WorkRecordPair;
				const startMs = target.period.startTime.getTime();
				const endMs = (target.period.endTime as Date).getTime();
				if (endMs - startMs < 2) continue;
				const at = parseInstant(new Date(rng.int(startMs + 1, endMs - 1)).toISOString());
				const reading = rng.pick([null, null, rng.int(0, 50_500)]);
				let plan = planChange(target, divide(at, { odometerKm: reading }));
				if (plan.kind === "vehicle_use_refused") plan = planChange(target, divide(at));
				if (plan.kind !== "divide") throw new Error(`seed ${seed}: unexpected ${plan.kind}`);

				for (const half of [plan.retained, plan.generated]) {
					expect(recordAgreement(half.period, half.canonical)).toEqual({
						agrees: true,
						disagreements: [],
					});
					// Policy never moves attribution other than the kilometres.
					expect(half.attribution.project).toEqual(
						target.period.projectId
							? {
									projectId: target.period.projectId,
									taskId: target.period.taskId,
									billable: target.period.isBillable,
								}
							: null,
					);
					expect(half.period.vehicleId).toBe(target.period.vehicleId);
				}
				expect(plan.retained.period.startTime).toEqual(target.period.startTime);
				expect(plan.retained.period.endTime).toEqual(plan.generated.period.startTime);
				expect(plan.generated.period.endTime).toEqual(target.period.endTime);
				segments = [
					...segments.slice(0, index),
					{ period: plan.retained.period, canonical: plan.retained.canonical },
					{ period: plan.generated.period, canonical: plan.generated.canonical },
					...segments.slice(index + 1),
				];
			}
			expect(segments[0]?.period.startTime).toEqual(source.period.startTime);
			expect(segments.at(-1)?.period.endTime).toEqual(source.period.endTime);
		},
	);
});
