import { describe, expect, it } from "vitest";
import { WorkAttribution } from "./work-attribution";

const PROJECT = "00000000-0000-4000-8000-000000000001";
const TASK = "00000000-0000-4000-8000-000000000002";
const CATEGORY = "00000000-0000-4000-8000-000000000003";
const VEHICLE = "00000000-0000-4000-8000-000000000004";

/** A work period's attribution columns as stored. */
const periodColumns = {
	projectId: PROJECT,
	taskId: TASK,
	isBillable: true,
	missingTask: false,
	workCategoryId: CATEGORY,
	workLocationType: "home" as const,
	vehicleKind: "organization" as const,
	vehicleId: VEHICLE,
	odometerStartKm: 1200,
	odometerEndKm: 1250,
	drivenDistanceKm: 50,
};

/** The same work's canonical detail and allocations as stored. */
const canonicalDetail = {
	workCategoryId: CATEGORY,
	workLocationType: "home" as const,
	vehicleKind: "organization" as const,
	vehicleId: VEHICLE,
	odometerStartKm: 1200,
	odometerEndKm: 1250,
	drivenDistanceKm: 50,
};
const projectAllocation = {
	allocationKind: "project" as const,
	projectId: PROJECT,
	taskId: TASK,
	costCenterId: null,
	weightPercent: 100,
	isBillable: true,
	missingTask: false,
};

describe("WorkAttribution round trip", () => {
	it("reads the same attribution from work-period columns and from the canonical record", () => {
		const fromPeriod = WorkAttribution.fromWorkPeriod(periodColumns);
		const fromCanonical = WorkAttribution.fromCanonical(canonicalDetail, [projectAllocation]);

		expect(fromPeriod.equals(fromCanonical)).toBe(true);
		expect(fromPeriod.differences(fromCanonical)).toEqual([]);
	});

	it("writes back the work-period columns it was read from", () => {
		expect(WorkAttribution.fromWorkPeriod(periodColumns).workPeriodColumns()).toEqual(
			periodColumns,
		);
	});

	it("writes a canonical record that reads back as the same attribution", () => {
		const attribution = WorkAttribution.fromWorkPeriod(periodColumns);
		const reread = WorkAttribution.fromCanonical(
			attribution.canonicalDetail(),
			attribution.canonicalAllocations([]),
		);

		expect(reread.equals(attribution)).toBe(true);
	});

	it("reads work without a project the same from both representations", () => {
		const unbooked = {
			...periodColumns,
			projectId: null,
			taskId: null,
			isBillable: false,
			vehicleKind: null,
			vehicleId: null,
			odometerStartKm: null,
			odometerEndKm: null,
			drivenDistanceKm: null,
		};
		const fromPeriod = WorkAttribution.fromWorkPeriod(unbooked);
		const fromCanonical = WorkAttribution.fromCanonical(
			{
				...canonicalDetail,
				vehicleKind: null,
				vehicleId: null,
				odometerStartKm: null,
				odometerEndKm: null,
				drivenDistanceKm: null,
			},
			[],
		);

		expect(fromPeriod.equals(fromCanonical)).toBe(true);
		expect(fromPeriod.project).toBeNull();
	});
});

describe("WorkAttribution canonical shape", () => {
	const COST_CENTER = "00000000-0000-4000-8000-000000000009";
	const costCenterAllocation = {
		id: "allocation-cc",
		allocationKind: "cost_center" as const,
		projectId: null,
		taskId: null,
		costCenterId: COST_CENTER,
		weightPercent: 40,
		isBillable: false,
		missingTask: false,
	};

	it("stores category, location and vehicle use on the canonical detail", () => {
		expect(WorkAttribution.fromWorkPeriod(periodColumns).canonicalDetail()).toEqual({
			workCategoryId: CATEGORY,
			workLocationType: "home",
			vehicleKind: "organization",
			vehicleId: VEHICLE,
			odometerStartKm: 1200,
			odometerEndKm: 1250,
			drivenDistanceKm: 50,
		});
	});

	it("books the project as one whole allocation and carries cost-centre allocations unchanged", () => {
		const staleProjectAllocation = {
			...projectAllocation,
			id: "allocation-old",
			projectId: "00000000-0000-4000-8000-0000000000aa",
			weightPercent: 50,
		};
		const allocations = WorkAttribution.fromWorkPeriod(periodColumns).canonicalAllocations([
			staleProjectAllocation,
			costCenterAllocation,
		]);

		expect(allocations).toEqual([
			costCenterAllocation,
			{
				allocationKind: "project",
				projectId: PROJECT,
				taskId: TASK,
				costCenterId: null,
				weightPercent: 100,
				isBillable: true,
				missingTask: false,
			},
		]);
		expect(allocations[0]).toBe(costCenterAllocation);
	});

	it("has no project allocation for work without a project", () => {
		const unbooked = WorkAttribution.fromWorkPeriod({
			...periodColumns,
			projectId: null,
			taskId: null,
			isBillable: false,
		});

		expect(unbooked.canonicalAllocations([projectAllocation, costCenterAllocation])).toEqual([
			costCenterAllocation,
		]);
	});
});

describe("WorkAttribution patch", () => {
	const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000cc";
	const OTHER_TASK = "00000000-0000-4000-8000-0000000000dd";
	const base = WorkAttribution.fromWorkPeriod(periodColumns);

	it("keeps everything for an empty patch", () => {
		const patched = base.apply({});

		expect(patched.equals(base)).toBe(true);
		expect(patched.workPeriodColumns()).toEqual(periodColumns);
	});

	it("keeps task and billability when the patch names the current project", () => {
		const patched = base.apply({
			project: { projectId: PROJECT, billableDefault: false },
		});

		expect(patched.project).toEqual({
			projectId: PROJECT,
			taskId: TASK,
			billable: true,
		});
	});

	it("clears the task when the project changes without naming one", () => {
		const patched = base.apply({
			project: { projectId: OTHER_PROJECT, billableDefault: true },
		});

		expect(patched.project).toEqual({
			projectId: OTHER_PROJECT,
			taskId: null,
			billable: true,
		});
	});

	it("books a task named with the new project", () => {
		const patched = base.apply({
			project: { projectId: OTHER_PROJECT, billableDefault: true },
			task: OTHER_TASK,
		});

		expect(patched.project?.taskId).toBe(OTHER_TASK);
	});

	it("books or clears a task on the current project", () => {
		expect(base.apply({ task: OTHER_TASK }).project).toEqual({
			projectId: PROJECT,
			taskId: OTHER_TASK,
			billable: true,
		});
		expect(base.apply({ task: null }).project).toEqual({
			projectId: PROJECT,
			taskId: null,
			billable: true,
		});
	});

	it("gives a new project its billable default", () => {
		expect(
			base.apply({
				project: { projectId: OTHER_PROJECT, billableDefault: false },
			}).project?.billable,
		).toBe(false);
		const unbilled = base.apply({ billable: false });
		expect(
			unbilled.apply({
				project: { projectId: OTHER_PROJECT, billableDefault: true },
			}).project?.billable,
		).toBe(true);
	});

	it("lets an explicit billable flag win over the new project's default", () => {
		const patched = base.apply({
			project: { projectId: OTHER_PROJECT, billableDefault: false },
			billable: true,
		});

		expect(patched.project?.billable).toBe(true);
	});

	it("sets billability alone on the current project", () => {
		expect(base.apply({ billable: false }).differences(base)).toEqual(["billable"]);
	});

	it("clears project, task and billability together", () => {
		const cleared = base.apply({ project: null });

		expect(cleared.project).toBeNull();
		expect(cleared.workPeriodColumns()).toMatchObject({
			projectId: null,
			taskId: null,
			isBillable: false,
		});
	});

	it("accepts an explicit non-billable flag when clearing the project", () => {
		expect(base.apply({ project: null, billable: false }).project).toBeNull();
	});

	it("refuses billable work or a task without a project", () => {
		expect(() => base.apply({ project: null, billable: true })).toThrow(
			expect.objectContaining({ reason: "billable_without_project" }),
		);
		expect(() => base.apply({ project: null, task: OTHER_TASK })).toThrow(
			expect.objectContaining({ reason: "task_without_project" }),
		);
		const unbooked = base.apply({ project: null });
		expect(() => unbooked.apply({ billable: true })).toThrow(
			expect.objectContaining({ reason: "billable_without_project" }),
		);
	});

	it("sets and clears category, location and vehicle use, keeping what it leaves out", () => {
		const ownCar = {
			vehicle: { kind: "own" as const },
			startKm: null,
			endKm: null,
			distanceKm: 12,
		};
		const patched = base.apply({
			workCategoryId: null,
			workLocationType: "office",
			vehicleUse: ownCar,
		});

		expect(patched.differences(base)).toEqual(["work_category", "work_location", "vehicle_use"]);
		expect(patched.vehicleUse).toEqual(ownCar);
		expect(patched.project).toEqual(base.project);
		expect(base.apply({ vehicleUse: null }).vehicleUse).toBeNull();
	});

	it("leaves the patched value unchanged", () => {
		base.apply({ project: null, workCategoryId: null });

		expect(base.workPeriodColumns()).toEqual(periodColumns);
	});
});

describe("WorkAttribution representability", () => {
	it("refuses a billable flag without a project", () => {
		expect(() =>
			WorkAttribution.fromWorkPeriod({
				...periodColumns,
				projectId: null,
				taskId: null,
			}),
		).toThrow(expect.objectContaining({ reason: "billable_without_project" }));
	});

	it("refuses a task without a project", () => {
		expect(() =>
			WorkAttribution.fromWorkPeriod({
				...periodColumns,
				projectId: null,
				isBillable: false,
			}),
		).toThrow(expect.objectContaining({ reason: "task_without_project" }));
	});
});

describe("WorkAttribution equality", () => {
	const base = WorkAttribution.fromWorkPeriod(periodColumns);
	const differing = (columns: Partial<typeof periodColumns>) =>
		base.differences(WorkAttribution.fromWorkPeriod({ ...periodColumns, ...columns }));

	it.each([
		[
			"project",
			{ projectId: "00000000-0000-4000-8000-0000000000bb", taskId: null },
			["project", "task"],
		],
		["task", { taskId: null }, ["task"]],
		["billable", { isBillable: false }, ["billable"]],
		["work category", { workCategoryId: null }, ["work_category"]],
		["work location", { workLocationType: "office" as const }, ["work_location"]],
	])("lists a different %s", (_, columns, parts) => {
		expect(differing(columns)).toEqual(parts);
	});

	it.each([
		["vehicle", { vehicleKind: "own" as const, vehicleId: null }],
		["start reading", { odometerStartKm: 1201 }],
		["end reading", { odometerEndKm: 1251 }],
		["driven distance", { drivenDistanceKm: 49 }],
		["missing vehicle use", { vehicleKind: null, vehicleId: null }],
	])("counts vehicle use as attribution: a different %s", (_, columns) => {
		expect(differing(columns)).toEqual(["vehicle_use"]);
		expect(base.equals(WorkAttribution.fromWorkPeriod({ ...periodColumns, ...columns }))).toBe(
			false,
		);
	});

	it("lists every differing part at once", () => {
		const other = WorkAttribution.fromWorkPeriod({
			projectId: null,
			taskId: null,
			isBillable: false,
			missingTask: false,
			workCategoryId: null,
			workLocationType: null,
			vehicleKind: null,
			vehicleId: null,
			odometerStartKm: null,
			odometerEndKm: null,
			drivenDistanceKm: null,
		});

		expect(base.differences(other)).toEqual([
			"project",
			"task",
			"billable",
			"work_category",
			"work_location",
			"vehicle_use",
		]);
	});
});

describe("WorkAttribution missing task (#884)", () => {
	const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000cc";
	const untasked = { ...periodColumns, taskId: null, missingTask: false };
	const marked = { ...untasked, missingTask: true };
	const markedAllocation = { ...projectAllocation, taskId: null, missingTask: true };

	it("reads the marker from both representations and writes it back", () => {
		const fromPeriod = WorkAttribution.fromWorkPeriod(marked);

		expect(fromPeriod.missingTask).toBe(true);
		expect(fromPeriod.workPeriodColumns()).toEqual(marked);
		expect(fromPeriod.canonicalAllocations([])).toEqual([markedAllocation]);
		expect(
			WorkAttribution.fromCanonical(canonicalDetail, [markedAllocation]).equals(fromPeriod),
		).toBe(true);
	});

	it("counts a marker disagreement as a task difference", () => {
		const fromPeriod = WorkAttribution.fromWorkPeriod(marked);
		const unmarkedCanonical = WorkAttribution.fromCanonical(canonicalDetail, [
			{ ...markedAllocation, missingTask: false },
		]);

		expect(fromPeriod.differences(unmarkedCanonical)).toEqual(["task"]);
	});

	it("marks untasked project work when the patch says so", () => {
		expect(WorkAttribution.fromWorkPeriod(untasked).apply({ missingTask: true }).missingTask).toBe(
			true,
		);
	});

	it("never marks work with a task or without a project", () => {
		const tasked = WorkAttribution.fromWorkPeriod({ ...periodColumns, missingTask: false });
		expect(tasked.apply({ missingTask: true }).missingTask).toBe(false);
		const unbooked = WorkAttribution.fromWorkPeriod({
			...untasked,
			projectId: null,
			isBillable: false,
		});
		expect(unbooked.apply({ missingTask: true }).missingTask).toBe(false);
	});

	it("keeps the marker through writes that keep the project and leave the task out", () => {
		const base = WorkAttribution.fromWorkPeriod(marked);

		expect(base.apply({}).missingTask).toBe(true);
		expect(base.apply({ billable: false, workCategoryId: null }).missingTask).toBe(true);
		expect(
			base.apply({ project: { projectId: PROJECT, billableDefault: false } }).missingTask,
		).toBe(true);
	});

	it("clears the marker once a task is booked or the project changes or clears", () => {
		const base = WorkAttribution.fromWorkPeriod(marked);

		expect(base.apply({ task: TASK }).missingTask).toBe(false);
		expect(
			base.apply({ project: { projectId: OTHER_PROJECT, billableDefault: false } }).missingTask,
		).toBe(false);
		expect(base.apply({ project: null, billable: false }).missingTask).toBe(false);
		expect(base.apply({ missingTask: false }).missingTask).toBe(false);
	});

	it("refuses a stored marker on work with a task or without a project", () => {
		expect(() => WorkAttribution.fromWorkPeriod({ ...periodColumns, missingTask: true })).toThrow(
			expect.objectContaining({ reason: "missing_task_with_task" }),
		);
		expect(() =>
			WorkAttribution.fromWorkPeriod({
				...marked,
				projectId: null,
				isBillable: false,
			}),
		).toThrow(expect.objectContaining({ reason: "missing_task_without_project" }));
	});
});
