import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { buildExportFiles } from "./zip-builder";

const period = {
	id: "period-1",
	employeeId: "employee-1",
	employeeName: "Ada Lovelace",
	employeeNumber: "E-1",
	startTime: new Date("2026-01-05T08:00:00Z"),
	endTime: new Date("2026-01-05T09:30:00Z"),
	durationMinutes: 90,
	isActive: false,
	clockInId: "in-1",
	clockOutId: "out-1",
	createdAt: new Date("2026-01-05T09:30:00Z"),
};

describe("the work periods CSV", () => {
	it("carries the project and task columns, empty when a period has neither", () => {
		const [file] = buildExportFiles("org-1", {
			work_periods: [
				{
					...period,
					projectId: "project-1",
					projectName: "Website",
					taskId: "task-1",
					taskName: "Design, phase 1",
				},
				{
					...period,
					id: "period-2",
					projectId: "project-1",
					projectName: "Website",
					taskId: null,
					taskName: null,
				},
				{
					...period,
					id: "period-3",
					projectId: null,
					projectName: null,
					taskId: null,
					taskName: null,
				},
			],
		});

		expect(file?.name).toBe("work_periods.csv");
		expect(file?.content.split("\n")).toEqual([
			"id,employeeId,employeeName,employeeNumber,startTime,endTime,durationMinutes,isActive,clockInId,clockOutId,createdAt,projectId,projectName,taskId,taskName",
			'period-1,employee-1,Ada Lovelace,E-1,2026-01-05T08:00:00.000Z,2026-01-05T09:30:00.000Z,90,false,in-1,out-1,2026-01-05T09:30:00.000Z,project-1,Website,task-1,"Design, phase 1"',
			"period-2,employee-1,Ada Lovelace,E-1,2026-01-05T08:00:00.000Z,2026-01-05T09:30:00.000Z,90,false,in-1,out-1,2026-01-05T09:30:00.000Z,project-1,Website,,",
			"period-3,employee-1,Ada Lovelace,E-1,2026-01-05T08:00:00.000Z,2026-01-05T09:30:00.000Z,90,false,in-1,out-1,2026-01-05T09:30:00.000Z,,,,",
		]);
	});
});
