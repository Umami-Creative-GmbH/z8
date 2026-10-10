import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { shift, shiftRecurrence } from "@/db/schema";
import { shiftCalendarDate } from "@/lib/scheduling/shift-date";

const mocks = vi.hoisted(() => ({
	timezone: "Europe/Berlin" as string | null,
	inserted: new Map<unknown, Array<Record<string, unknown>>>(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: vi.fn(async () =>
					mocks.timezone === null ? undefined : { timezone: mocks.timezone },
				),
			},
			shiftTemplate: {
				findMany: vi.fn(async () => [
					{
						id: "template-1",
						organizationId: "org-1",
						subareaId: "subarea-1",
						startTime: "08:00",
						endTime: "16:00",
						color: "#000000",
					},
				]),
			},
			location: {
				findMany: vi.fn(async () => [
					{ id: "location-1", organizationId: "org-1" },
				]),
			},
			locationSubarea: {
				findMany: vi.fn(async () => [
					{ id: "subarea-1", locationId: "location-1" },
				]),
			},
			employee: { findMany: vi.fn(async () => []) },
		},
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((value: Record<string, unknown>) => ({
				returning: vi.fn(async () => {
					const rows = mocks.inserted.get(table) ?? [];
					const row = { id: `row-${rows.length + 1}`, ...value };
					rows.push(row);
					mocks.inserted.set(table, rows);
					return [row];
				}),
			})),
		})),
	},
}));

const options = {
	organizationId: "org-1",
	includeTimeEntries: false,
	includeAbsences: false,
	includeTeams: false,
	includeProjects: false,
	includeShifts: true,
	generateShiftInstances: true,
	createdBy: "user-1",
};

function insertedDates(
	table: unknown,
	column: "date" | "startDate" | "endDate",
) {
	return (mocks.inserted.get(table) ?? []).map((row) =>
		(row[column] as Date).toISOString(),
	);
}

describe("generateDemoShifts", () => {
	let generateDemoShifts: typeof import("./demo-data.service").generateDemoShifts;

	beforeAll(async () => {
		({ generateDemoShifts } = await import("./demo-data.service"));
	}, 30_000);

	beforeEach(() => {
		mocks.timezone = "Europe/Berlin";
		mocks.inserted.clear();
	});

	it("writes org-local midnights on the organization's weekdays across a weekend and DST", async () => {
		// Sunday 23:30Z is Monday 2026-03-23 00:30 in Berlin; Sunday 22:30Z after the
		// 2026-03-29 DST switch is Monday 2026-04-06 00:30.
		const result = await generateDemoShifts({
			...options,
			dateRange: {
				start: new Date("2026-03-22T23:30:00.000Z"),
				end: new Date("2026-04-05T22:30:00.000Z"),
			},
		});

		expect(insertedDates(shift, "date")).toEqual([
			"2026-03-22T23:00:00.000Z",
			"2026-03-23T23:00:00.000Z",
			"2026-03-24T23:00:00.000Z",
			"2026-03-25T23:00:00.000Z",
			"2026-03-26T23:00:00.000Z",
			"2026-03-29T22:00:00.000Z",
			"2026-03-30T22:00:00.000Z",
			"2026-03-31T22:00:00.000Z",
			"2026-04-01T22:00:00.000Z",
			"2026-04-02T22:00:00.000Z",
			"2026-04-05T22:00:00.000Z",
		]);
		const weekdays = (mocks.inserted.get(shift) ?? []).map(
			(row) => shiftCalendarDate(row.date as Date, "Europe/Berlin").dayOfWeek,
		);
		expect(weekdays.every((day) => day >= 1 && day <= 5)).toBe(true);
		expect(insertedDates(shiftRecurrence, "startDate")).toEqual([
			"2026-03-22T23:00:00.000Z",
		]);
		expect(insertedDates(shiftRecurrence, "endDate")).toEqual([
			"2026-04-05T22:00:00.000Z",
		]);
		expect(result).toMatchObject({ recurrencesCreated: 1, shiftsCreated: 11 });
	});

	it("falls back to UTC midnights when the organization has no timezone", async () => {
		mocks.timezone = null;

		await generateDemoShifts({
			...options,
			dateRange: {
				start: new Date("2026-03-27T15:00:00.000Z"),
				end: new Date("2026-03-30T09:00:00.000Z"),
			},
		});

		expect(insertedDates(shift, "date")).toEqual([
			"2026-03-27T00:00:00.000Z",
			"2026-03-30T00:00:00.000Z",
		]);
	});
});
