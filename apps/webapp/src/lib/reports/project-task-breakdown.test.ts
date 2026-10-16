import { describe, expect, it } from "vitest";
import { buildProjectTaskBreakdown } from "./project-task-breakdown";

const design = {
	id: "task-design",
	name: "Design",
	state: "open" as const,
	estimateHours: "10.00",
};
const build = { id: "task-build", name: "Build", state: "done" as const, estimateHours: null };

describe("buildProjectTaskBreakdown", () => {
	it("adds up to the project total with a No task row for untasked time", () => {
		const rows = buildProjectTaskBreakdown({
			periods: [
				{ taskId: "task-design", durationMinutes: 90 },
				{ taskId: "task-build", durationMinutes: 60 },
				{ taskId: null, durationMinutes: 30 },
				{ taskId: "task-design", durationMinutes: 60 },
				{ taskId: null, durationMinutes: null },
			],
			tasks: [design, build],
			bookedMinutesToDate: new Map([["task-design", 300]]),
		});

		expect(rows).toEqual([
			{
				taskId: "task-design",
				taskName: "Design",
				state: "open",
				totalMinutes: 150,
				totalHours: 2.5,
				workPeriodCount: 2,
				percentOfTotal: 62.5,
				estimate: { estimateHours: 10, bookedHours: 5, percentUsed: 50 },
			},
			{
				taskId: "task-build",
				taskName: "Build",
				state: "done",
				totalMinutes: 60,
				totalHours: 1,
				workPeriodCount: 1,
				percentOfTotal: 25,
				estimate: null,
			},
			{
				taskId: null,
				taskName: null,
				state: null,
				totalMinutes: 30,
				totalHours: 0.5,
				workPeriodCount: 2,
				percentOfTotal: 12.5,
				estimate: null,
			},
		]);
		expect(rows.reduce((sum, row) => sum + row.totalMinutes, 0)).toBe(240);
	});

	it("leaves out the No task row when every period has a task", () => {
		const rows = buildProjectTaskBreakdown({
			periods: [{ taskId: "task-build", durationMinutes: 45 }],
			tasks: [design, build],
			bookedMinutesToDate: new Map(),
		});

		expect(rows.map((row) => row.taskId)).toEqual(["task-build"]);
		expect(rows[0]?.percentOfTotal).toBe(100);
	});

	it("counts the No task row's bookings that are missing a task (#884)", () => {
		const rows = buildProjectTaskBreakdown({
			periods: [
				{ taskId: null, durationMinutes: 60, missingTask: true },
				{ taskId: null, durationMinutes: 30 },
				{ taskId: null, durationMinutes: 45, missingTask: true },
				{ taskId: "task-design", durationMinutes: 60 },
			],
			tasks: [design],
			bookedMinutesToDate: new Map(),
		});

		expect(rows.find((row) => row.taskId === null)).toMatchObject({
			totalMinutes: 135,
			workPeriodCount: 3,
			missingTaskCount: 2,
		});
		expect(rows.find((row) => row.taskId === "task-design")).not.toHaveProperty("missingTaskCount");
	});

	it("gives the No task row no count when none of its bookings is missing a task", () => {
		const rows = buildProjectTaskBreakdown({
			periods: [{ taskId: null, durationMinutes: 30 }],
			tasks: [],
			bookedMinutesToDate: new Map(),
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]).not.toHaveProperty("missingTaskCount");
	});

	it("is empty when nothing was booked", () => {
		expect(
			buildProjectTaskBreakdown({ periods: [], tasks: [design], bookedMinutesToDate: new Map() }),
		).toEqual([]);
	});

	it("reports estimate progress from all hours booked to the task, not only the period", () => {
		const [row] = buildProjectTaskBreakdown({
			periods: [{ taskId: "task-design", durationMinutes: 60 }],
			tasks: [design],
			bookedMinutesToDate: new Map([["task-design", 720]]),
		});

		expect(row?.estimate).toEqual({ estimateHours: 10, bookedHours: 12, percentUsed: 120 });
	});
});
