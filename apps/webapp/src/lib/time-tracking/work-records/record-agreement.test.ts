import { describe, expect, it } from "vitest";
import {
	type AgreementCanonicalRecord,
	type AgreementWorkPeriod,
	recordAgreement,
} from "./record-agreement";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const TASK = "00000000-0000-4000-8000-000000000002";
const CATEGORY = "00000000-0000-4000-8000-000000000003";
const VEHICLE = "00000000-0000-4000-8000-000000000004";
const COST_CENTER = "00000000-0000-4000-8000-000000000005";

const period: AgreementWorkPeriod = {
	startTime: new Date("2026-03-02T07:00:00.000Z"),
	endTime: new Date("2026-03-02T15:30:00.000Z"),
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
};

const projectAllocation = {
	allocationKind: "project" as const,
	projectId: PROJECT,
	taskId: TASK,
	costCenterId: null,
	weightPercent: 100,
	isBillable: true,
};

const canonical: AgreementCanonicalRecord = {
	record: {
		startAt: new Date("2026-03-02T07:00:00.000Z"),
		endAt: new Date("2026-03-02T15:30:00.000Z"),
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
		{
			allocationKind: "cost_center",
			projectId: null,
			taskId: null,
			costCenterId: COST_CENTER,
			weightPercent: 30,
			isBillable: false,
		},
		projectAllocation,
	],
};

const withRecord = (record: Partial<AgreementCanonicalRecord["record"]>) => ({
	...canonical,
	record: { ...canonical.record, ...record },
});
const withDetail = (detail: Partial<AgreementCanonicalRecord["detail"]>) => ({
	...canonical,
	detail: { ...canonical.detail, ...detail },
});
const withProjectAllocations = (
	...allocations: Partial<typeof projectAllocation>[]
): AgreementCanonicalRecord => ({
	...canonical,
	allocations: [
		canonical.allocations[0],
		...allocations.map((allocation) => ({
			...projectAllocation,
			...allocation,
		})),
	],
});

describe("recordAgreement", () => {
	it("agrees when the work period and its canonical work record describe the same work", () => {
		expect(recordAgreement(period, canonical)).toEqual({
			agrees: true,
			disagreements: [],
		});
	});

	it("compares the missing-task marker as part of the task (#884)", () => {
		const withoutTask = { ...period, taskId: null };
		const marked = { ...withoutTask, missingTask: true };
		const allocation = (missingTask: boolean) =>
			withProjectAllocations({ taskId: null, missingTask } as Partial<typeof projectAllocation>);

		expect(recordAgreement(marked, allocation(true))).toEqual({ agrees: true, disagreements: [] });
		expect(recordAgreement(marked, allocation(false))).toEqual({
			agrees: false,
			disagreements: ["task"],
		});
		expect(recordAgreement({ ...withoutTask, missingTask: false }, allocation(true))).toEqual({
			agrees: false,
			disagreements: ["task"],
		});
	});

	it("agrees on work without a project and without vehicle use", () => {
		const unbooked = {
			...period,
			projectId: null,
			taskId: null,
			isBillable: false,
			vehicleKind: null,
			vehicleId: null,
			odometerStartKm: null,
			odometerEndKm: null,
			drivenDistanceKm: null,
		};
		const record = {
			...canonical,
			detail: {
				...canonical.detail,
				vehicleKind: null,
				vehicleId: null,
				odometerStartKm: null,
				odometerEndKm: null,
				drivenDistanceKm: null,
			},
			allocations: [canonical.allocations[0]],
		};

		expect(recordAgreement(unbooked, record).agrees).toBe(true);
	});

	it.each<[string, AgreementCanonicalRecord, string]>([
		[
			"a different start",
			withRecord({ startAt: new Date("2026-03-02T07:00:01.000Z") }),
			"interval",
		],
		["a different end", withRecord({ endAt: new Date("2026-03-02T15:00:00.000Z") }), "interval"],
		["no end", withRecord({ endAt: null }), "interval"],
		["a different duration", withRecord({ durationMinutes: 480 }), "duration"],
		["a different approval state", withRecord({ approvalState: "pending" }), "approval_state"],
		["a draft canonical record", withRecord({ approvalState: "draft" }), "approval_state"],
		[
			"another project",
			withProjectAllocations({
				projectId: "00000000-0000-4000-8000-0000000000aa",
			}),
			"project",
		],
		["another task", withProjectAllocations({ taskId: null }), "task"],
		["another billable flag", withProjectAllocations({ isBillable: false }), "billable"],
		[
			"a partial project allocation",
			withProjectAllocations({ weightPercent: 50 }),
			"allocation_weight",
		],
		["two project allocations", withProjectAllocations({}, {}), "allocation_weight"],
		["another work category", withDetail({ workCategoryId: null }), "work_category"],
		["another work location", withDetail({ workLocationType: "home" }), "work_location"],
		["another vehicle", withDetail({ vehicleKind: "own", vehicleId: null }), "vehicle_use"],
		["another odometer reading", withDetail({ odometerEndKm: 181 }), "vehicle_use"],
		["another driven distance", withDetail({ drivenDistanceKm: 81 }), "vehicle_use"],
	])("reports %s on its own", (_, record, facet) => {
		expect(recordAgreement(period, record)).toEqual({
			agrees: false,
			disagreements: [facet],
		});
	});

	it("reports a project allocation on work without a project as a project disagreement", () => {
		const unbooked = {
			...period,
			projectId: null,
			taskId: null,
			isBillable: false,
		};

		expect(
			recordAgreement(unbooked, withProjectAllocations({ taskId: null, isBillable: false })),
		).toEqual({ agrees: false, disagreements: ["project"] });
	});

	it("reports a missing project allocation as a project disagreement", () => {
		const record = { ...canonical, allocations: [canonical.allocations[0]] };

		expect(recordAgreement(period, record).disagreements).toEqual(["project", "task", "billable"]);
	});

	it("ignores cost-centre allocations", () => {
		const record = { ...canonical, allocations: [projectAllocation] };

		expect(recordAgreement(period, record).agrees).toBe(true);
	});

	it("reports every disagreeing facet at once, in a fixed order", () => {
		const record: AgreementCanonicalRecord = {
			record: {
				startAt: new Date("2026-03-02T08:00:00.000Z"),
				endAt: new Date("2026-03-02T15:30:00.000Z"),
				durationMinutes: 450,
				approvalState: "rejected",
			},
			detail: {
				workCategoryId: null,
				workLocationType: null,
				vehicleKind: null,
				vehicleId: null,
				odometerStartKm: null,
				odometerEndKm: null,
				drivenDistanceKm: null,
			},
			allocations: [
				{
					...projectAllocation,
					projectId: "00000000-0000-4000-8000-0000000000aa",
					taskId: null,
					isBillable: false,
					weightPercent: 60,
				},
			],
		};

		expect(recordAgreement(period, record).disagreements).toEqual([
			"interval",
			"duration",
			"approval_state",
			"project",
			"task",
			"billable",
			"allocation_weight",
			"work_category",
			"work_location",
			"vehicle_use",
		]);
	});
});
