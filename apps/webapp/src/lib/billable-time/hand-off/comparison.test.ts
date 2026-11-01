import { describe, expect, it } from "vitest";
import { type ComparedPiece, compareWork } from "./comparison";

const website = { projectId: "p-web", projectName: "Website" };
const acme = { customerId: "c-acme", customerName: "Acme" };

/** 08:00–09:30 UTC, recorded at UTC+02:00 (10:00–11:30 local). */
const handedOff: ComparedPiece = {
	removed: false,
	startedAt: "2026-09-02T08:00:00.000Z",
	endedAt: "2026-09-02T09:30:00.000Z",
	startOffsetMinutes: 120,
	endOffsetMinutes: 120,
	durationMinutes: 90,
	...website,
	...acme,
	billable: true,
};

describe("compareWork", () => {
	it("shows a times correction against the hand-off, in the work's recorded offsets", () => {
		const comparison = compareWork({
			handOff: handedOff,
			lastResolved: null,
			current: [{ ...handedOff, endedAt: "2026-09-02T09:45:00.000Z", durationMinutes: 105 }],
		});

		expect(comparison.handOff).toEqual({
			removed: false,
			pieceCount: 1,
			removedPieceCount: 0,
			day: "2026-09-02",
			start: { at: "2026-09-02T08:00:00.000Z", offsetMinutes: 120 },
			end: { at: "2026-09-02T09:30:00.000Z", offsetMinutes: 120 },
			durationMinutes: 90,
			hours: "1.50",
			projects: [{ id: "p-web", name: "Website" }],
			customers: [{ id: "c-acme", name: "Acme" }],
			billability: "billable",
		});
		expect(comparison.current).toMatchObject({
			end: { at: "2026-09-02T09:45:00.000Z", offsetMinutes: 120 },
			hours: "1.75",
			changedFromHandOff: ["end", "hours"],
			changedSinceResolution: null,
		});
		expect(comparison.lastResolved).toBeNull();
	});

	it("sums an automatic-break split's pieces: earliest start, latest end at its own offset", () => {
		const { current } = compareWork({
			handOff: handedOff,
			lastResolved: null,
			current: [
				{ ...handedOff, endedAt: "2026-09-02T08:30:00.000Z", durationMinutes: 30 },
				{
					...handedOff,
					startedAt: "2026-09-02T08:45:00.000Z",
					// Clocked out after a move to UTC+01:00.
					endOffsetMinutes: 60,
					durationMinutes: 45,
				},
			],
		});

		expect(current).toMatchObject({
			pieceCount: 2,
			start: { at: "2026-09-02T08:00:00.000Z", offsetMinutes: 120 },
			end: { at: "2026-09-02T09:30:00.000Z", offsetMinutes: 60 },
			durationMinutes: 75,
			hours: "1.25",
			changedFromHandOff: ["hours"],
		});
	});

	it("shows removed work as removed only, and a removed piece as a partial removal", () => {
		const removed = compareWork({
			handOff: handedOff,
			lastResolved: null,
			current: [{ ...handedOff, removed: true }],
		}).current;
		expect(removed).toMatchObject({
			removed: true,
			removedPieceCount: 1,
			day: null,
			durationMinutes: 0,
			billability: null,
			changedFromHandOff: ["removed"],
		});

		const partly = compareWork({
			handOff: handedOff,
			lastResolved: null,
			current: [
				{ ...handedOff, endedAt: "2026-09-02T09:00:00.000Z", durationMinutes: 60 },
				{ ...handedOff, startedAt: "2026-09-02T09:00:00.000Z", durationMinutes: 30, removed: true },
			],
		}).current;
		expect(partly).toMatchObject({
			removed: false,
			pieceCount: 2,
			removedPieceCount: 1,
			durationMinutes: 60,
			changedFromHandOff: ["end", "hours", "removed"],
		});
	});

	it("compares the current values with the last resolution as well as with the hand-off", () => {
		const resolved = { ...handedOff, durationMinutes: 80 };
		const comparison = compareWork({
			handOff: handedOff,
			lastResolved: { resolvedAt: "2026-10-01T10:00:00.000Z", pieces: [resolved] },
			current: [{ ...resolved, billable: false }],
		});

		expect(comparison.lastResolved).toMatchObject({
			resolvedAt: "2026-10-01T10:00:00.000Z",
			hours: "1.33",
			changedFromHandOff: ["hours"],
		});
		expect(comparison.current).toMatchObject({
			billability: "non_billable",
			changedFromHandOff: ["hours", "billability"],
			changedSinceResolution: ["billability"],
		});
	});

	it("shows a project moved to another customer or to none, and pieces on several projects", () => {
		const moved = compareWork({
			handOff: handedOff,
			lastResolved: null,
			current: [{ ...handedOff, customerId: null, customerName: null }],
		}).current;
		expect(moved).toMatchObject({
			customers: [{ id: null, name: null }],
			changedFromHandOff: ["customer"],
		});

		const spread = compareWork({
			handOff: handedOff,
			lastResolved: null,
			current: [
				{ ...handedOff, endedAt: "2026-09-02T09:00:00.000Z", durationMinutes: 60 },
				{
					...handedOff,
					startedAt: "2026-09-02T09:00:00.000Z",
					durationMinutes: 30,
					projectId: "p-app",
					projectName: "App",
					billable: false,
				},
			],
		}).current;
		expect(spread).toMatchObject({
			projects: [
				{ id: "p-web", name: "Website" },
				{ id: "p-app", name: "App" },
			],
			customers: [{ id: "c-acme", name: "Acme" }],
			billability: "mixed",
			changedFromHandOff: ["project", "billability"],
		});
	});

	it("reads the work-local day at the recorded offset, not in UTC", () => {
		const { handOff } = compareWork({
			handOff: { ...handedOff, startedAt: "2026-09-01T22:30:00.000Z" },
			lastResolved: null,
			current: [handedOff],
		});
		expect(handOff.day).toBe("2026-09-02");
	});
});
