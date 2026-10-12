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

const entry = {
	id: "entry-1",
	employeeId: "employee-1",
	employeeName: "Field Worker",
	employeeNumber: "N-1",
	type: "clock_in",
	timestamp: new Date("2026-09-20T06:00:00Z"),
	notes: null,
	deviceInfo: null,
	replacesEntryId: null,
	isSuperseded: false,
	createdAt: new Date("2026-09-20T06:00:01Z"),
};

function timeEntriesCsv(data: unknown): string[] {
	const [file] = buildExportFiles("org-1", { time_entries: data });
	if (!file) throw new Error("no time entries file");
	expect(file.name).toBe("time_entries.csv");
	return file.content.split("\n");
}

describe("time entries file of the org data export", () => {
	it("has no location column when the export carries no position stamps", () => {
		const [header, row] = timeEntriesCsv([entry]);

		expect(header).toBe(
			"id,employeeId,employeeName,employeeNumber,type,timestamp,notes,deviceInfo,replacesEntryId,isSuperseded,createdAt",
		);
		expect(row).toBe(
			"entry-1,employee-1,Field Worker,N-1,clock_in,2026-09-20T06:00:00.000Z,,,,false,2026-09-20T06:00:01.000Z",
		);
	});

	it("puts the position stamp columns where location was when the export carries stamps", () => {
		const [header, stamped, unstamped] = timeEntriesCsv([
			{
				...entry,
				positionLatitude: 0,
				positionLongitude: -0.1275,
				positionAccuracyMeters: 0,
				positionFixedAt: new Date("2026-09-20T05:59:58Z"),
			},
			{
				...entry,
				id: "entry-2",
				positionLatitude: null,
				positionLongitude: null,
				positionAccuracyMeters: null,
				positionFixedAt: null,
			},
		]);

		expect(header).toBe(
			"id,employeeId,employeeName,employeeNumber,type,timestamp,notes,positionLatitude,positionLongitude,positionAccuracyMeters,positionFixedAt,deviceInfo,replacesEntryId,isSuperseded,createdAt",
		);
		expect(stamped).toBe(
			"entry-1,employee-1,Field Worker,N-1,clock_in,2026-09-20T06:00:00.000Z,,0,-0.1275,0,2026-09-20T05:59:58.000Z,,,false,2026-09-20T06:00:01.000Z",
		);
		expect(unstamped).toBe(
			"entry-2,employee-1,Field Worker,N-1,clock_in,2026-09-20T06:00:00.000Z,,,,,,,,false,2026-09-20T06:00:01.000Z",
		);
	});
});

describe("table datasets (projects, customers)", () => {
	it("write their own columns, keep custom field dates and texts as they are, and always a header", () => {
		const table = {
			format: "csv-table" as const,
			columns: [
				{ key: "id", header: "id" },
				{ key: "createdAt", header: "createdAt" },
				{ key: "customField:f-start", header: "Start date" },
				{ key: "customField:f-code", header: "Rate" },
			],
			rows: [
				{
					id: "project-1",
					createdAt: new Date("2026-01-05T09:30:00Z"),
					"customField:f-start": "2024-02-29",
					"customField:f-code": "2024",
				},
			],
		};

		const files = buildExportFiles("org-1", {
			projects: table,
			customers: { ...table, rows: [] },
		});

		expect(files.map((file) => file.name)).toEqual(["projects.csv", "customers.csv"]);
		expect(files[0]?.content.split("\n")).toEqual([
			"id,createdAt,Start date,Rate",
			"project-1,2026-01-05T09:30:00.000Z,2024-02-29,2024",
		]);
		expect(files[1]?.content).toBe("id,createdAt,Start date,Rate");
	});
});
