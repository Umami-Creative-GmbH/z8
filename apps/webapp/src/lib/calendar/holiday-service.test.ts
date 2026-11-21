import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { loadCalculationExclusions } from "./holiday-service";

type StoredRow = {
	startDate: string;
	endDate: string;
	recurrenceType?: "none" | "yearly";
	recurrenceRule?: string | null;
};

function readerReturning(rows: StoredRow[]) {
	const result = rows.map((row) => ({
		holiday: {
			startDate: new Date(row.startDate),
			endDate: new Date(row.endDate),
			recurrenceType: row.recurrenceType ?? "none",
			recurrenceRule: row.recurrenceRule ?? null,
			recurrenceEndDate: null,
		},
		category: {},
	}));
	const chain = {
		from: () => chain,
		innerJoin: () => chain,
		where: async () => result,
	};
	return { select: () => chain } as unknown as Parameters<typeof loadCalculationExclusions>[0];
}

async function excludedDays(rows: StoredRow[], days: string[]) {
	const isExcluded = await loadCalculationExclusions(
		readerReturning(rows),
		"org-1",
		new Date("2026-12-01T00:00:00.000Z"),
		new Date("2026-12-31T23:59:59.999Z"),
	);
	return days.filter((day) => isExcluded(new Date(`${day}T00:00:00.000Z`)));
}

describe("loadCalculationExclusions", () => {
	const days = ["2026-12-23", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27"];

	it("excludes an imported local-midnight holiday on its calendar date only", async () => {
		// Europe/Berlin Christmas Day as the date-holidays import stores it.
		await expect(
			excludedDays(
				[{ startDate: "2026-12-24T23:00:00.000Z", endDate: "2026-12-25T23:00:00.000Z" }],
				days,
			),
		).resolves.toEqual(["2026-12-25"]);
	});

	it("excludes a UTC-date holiday through its inclusive end date", async () => {
		await expect(
			excludedDays(
				[{ startDate: "2026-12-24T00:00:00.000Z", endDate: "2026-12-26T00:00:00.000Z" }],
				days,
			),
		).resolves.toEqual(["2026-12-24", "2026-12-25", "2026-12-26"]);
	});

	it("excludes a yearly holiday on its rule date", async () => {
		await expect(
			excludedDays(
				[
					{
						startDate: "2024-12-25T00:00:00.000Z",
						endDate: "2024-12-25T00:00:00.000Z",
						recurrenceType: "yearly",
						recurrenceRule: JSON.stringify({ month: 12, day: 25 }),
					},
				],
				days,
			),
		).resolves.toEqual(["2026-12-25"]);
	});
});
