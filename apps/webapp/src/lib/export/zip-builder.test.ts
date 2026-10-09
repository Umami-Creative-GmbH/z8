import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn() }),
}));

import { buildExportFiles } from "./zip-builder";

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
