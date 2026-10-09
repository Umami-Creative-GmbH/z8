import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { invoiceDraftNetTotal } from "@/lib/billable-time/accounting/invoice-draft";
import type { BillableRatePeriod } from "@/lib/billable-time/applicable-rate";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type HandOffCandidate, handOffTextFormat, planHandOff } from "./hand-off-plan";

const day = (value: string) => Temporal.PlainDate.from(value);
const PROJECT_A = "10000000-0000-4000-8000-00000000000a";
const PROJECT_B = "10000000-0000-4000-8000-00000000000b";
const CUSTOMER = "10000000-0000-4000-8000-0000000000c1";
const ANNA = "10000000-0000-4000-8000-0000000000e1";
const BEN = "10000000-0000-4000-8000-0000000000e2";

let nextId = 1;
function work(overrides: Partial<HandOffCandidate> & { start: string; minutes: number }) {
	const { start, minutes, ...rest } = overrides;
	const startedAt = parseInstant(start);
	return {
		id: `w-${nextId++}`,
		employeeId: ANNA,
		employeeName: "Anna Berg",
		projectId: PROJECT_A,
		projectName: "Website",
		customerId: CUSTOMER,
		startedAt,
		endedAt: startedAt.add({ minutes }),
		startOffsetMinutes: 0,
		durationMinutes: minutes,
		isBillable: true,
		pendingReview: false,
		invoiced: false,
		...rest,
	} satisfies HandOffCandidate;
}

function rate(
	projectId: string,
	cents: number,
	from: string,
	to: string | null = null,
): BillableRatePeriod {
	return {
		id: `rate-${projectId}-${from}`,
		level: "project",
		employeeId: null,
		projectId,
		customerId: null,
		from: day(from),
		to: to === null ? null : day(to),
		rate: BigInt(cents),
	};
}

const september = { from: day("2026-09-01"), to: day("2026-09-30") };
const english = handOffTextFormat("en");

function plan(input: {
	work: HandOffCandidate[];
	rates: BillableRatePeriod[];
	includeTimesheet?: boolean;
	maxDraftLines?: number;
}) {
	return planHandOff({
		period: september,
		work: input.work,
		rates: input.rates,
		texts: english,
		includeTimesheet: input.includeTimesheet ?? false,
		maxDraftLines: input.maxDraftLines ?? 300,
	});
}

describe("planHandOff", () => {
	it("groups lines per project and applicable rate, exact minutes as hours with two decimals", () => {
		const result = plan({
			work: [
				work({ start: "2026-09-02T08:00:00Z", minutes: 90 }),
				work({ start: "2026-09-03T08:00:00Z", minutes: 50, employeeId: BEN }),
				work({
					start: "2026-09-04T08:00:00Z",
					minutes: 61,
					projectId: PROJECT_B,
					projectName: "App",
				}),
			],
			rates: [rate(PROJECT_A, 10_000, "2026-01-01"), rate(PROJECT_B, 8_550, "2026-01-01")],
		});

		expect(result.blockers).toEqual([]);
		expect(
			result.lines.map((line) => ({
				project: line.projectName,
				quantity: line.quantityHundredths,
				unitPrice: line.unitPrice,
				amount: line.amount,
				text: line.text,
			})),
		).toEqual([
			// 61 minutes = 1.0166… h → 1.02 h × 85.50 = 87.21
			{
				project: "App",
				quantity: 102,
				unitPrice: BigInt(8_550),
				amount: BigInt(8_721),
				text: "App, 2026-09-01 – 2026-09-30: 1.02 h",
			},
			// 140 minutes = 2.333… h → 2.33 h × 100.00 = 233.00
			{
				project: "Website",
				quantity: 233,
				unitPrice: BigInt(10_000),
				amount: BigInt(23_300),
				text: "Website, 2026-09-01 – 2026-09-30: 2.33 h",
			},
		]);
		expect(result.netTotal).toBe(BigInt(32_021));
		expect(invoiceDraftNetTotal({ lines: result.lines })).toBe(result.netTotal);
		expect(result.included.map((item) => item.work.durationMinutes)).toEqual([90, 50, 61]);
	});

	it("allocates each line's frozen amount across its work by duration, to the cent", () => {
		const result = plan({
			work: [
				work({ start: "2026-09-02T08:00:00Z", minutes: 90 }),
				work({ start: "2026-09-03T08:00:00Z", minutes: 50 }),
			],
			rates: [rate(PROJECT_A, 10_000, "2026-01-01")],
		});

		// 233.00 split 90:50 = 149.785… : 83.214… → the larger remainder gets the cent.
		expect(result.included.map((item) => item.shares.map((share) => share.amount))).toEqual([
			[BigInt(14_979)],
			[BigInt(8_321)],
		]);
		const allocated = result.included
			.flatMap((item) => item.shares)
			.reduce((sum, share) => sum + share.amount, BigInt(0));
		expect(allocated).toBe(result.netTotal);
	});

	it("splits a period that spans a rate change across the two rates' lines", () => {
		const result = plan({
			// 22:00–02:00 UTC across the rate change on 2026-09-10, 240 minutes recorded.
			work: [work({ start: "2026-09-09T22:00:00Z", minutes: 240 })],
			rates: [
				rate(PROJECT_A, 10_000, "2026-01-01", "2026-09-10"),
				rate(PROJECT_A, 12_000, "2026-09-10"),
			],
		});

		expect(result.lines.map((line) => [line.unitPrice, line.quantityHundredths])).toEqual([
			[BigInt(10_000), 200],
			[BigInt(12_000), 200],
		]);
		expect(result.included[0]?.shares).toEqual([
			{ line: 0, durationMs: 7_200_000, rate: BigInt(10_000), amount: BigInt(20_000) },
			{ line: 1, durationMs: 7_200_000, rate: BigInt(12_000), amount: BigInt(24_000) },
		]);
	});

	it("leaves out held-back, already invoiced and non-billable work and reports each", () => {
		const held = work({ start: "2026-09-02T08:00:00Z", minutes: 60, pendingReview: true });
		const invoiced = work({ start: "2026-09-03T08:00:00Z", minutes: 60, invoiced: true });
		const internal = work({ start: "2026-09-04T08:00:00Z", minutes: 45, isBillable: false });
		const ready = work({ start: "2026-09-05T08:00:00Z", minutes: 30 });

		const result = plan({
			work: [held, invoiced, internal, ready],
			rates: [rate(PROJECT_A, 10_000, "2026-01-01")],
		});

		expect(result.included.map((item) => item.work.id)).toEqual([ready.id]);
		expect(result.heldBack.map((item) => item.id)).toEqual([held.id]);
		expect(result.alreadyInvoiced.map((item) => item.id)).toEqual([invoiced.id]);
		expect(result.nonBillable).toEqual({ count: 1, minutes: 45 });
		expect(result.netTotal).toBe(BigInt(5_000));
	});

	it("blocks the hand-off while billable work is unpriced, listing that work", () => {
		const priced = work({ start: "2026-09-02T08:00:00Z", minutes: 60 });
		const unpriced = work({
			start: "2026-09-03T08:00:00Z",
			minutes: 60,
			projectId: PROJECT_B,
			projectName: "App",
		});

		const result = plan({
			work: [priced, unpriced],
			rates: [rate(PROJECT_A, 10_000, "2026-01-01")],
		});

		expect(result.unpriced.map((item) => [item.work.id, item.unpricedMs])).toEqual([
			[unpriced.id, 3_600_000],
		]);
		expect(result.blockers).toEqual([{ kind: "unpriced_work", count: 1 }]);
	});

	it("blocks when nothing can be handed off", () => {
		const result = plan({
			work: [work({ start: "2026-09-02T08:00:00Z", minutes: 60, invoiced: true })],
			rates: [rate(PROJECT_A, 10_000, "2026-01-01")],
		});

		expect(result.lines).toEqual([]);
		expect(result.blockers).toEqual([{ kind: "nothing_to_hand_off" }]);
	});

	it("adds the timesheet as text lines, one per period, within the tool's line limit", () => {
		const items = [
			work({ start: "2026-09-02T08:00:00Z", minutes: 90 }),
			work({
				start: "2026-09-03T08:00:00Z",
				minutes: 50,
				employeeId: BEN,
				employeeName: "Ben Ott",
			}),
		];
		const rates = [rate(PROJECT_A, 10_000, "2026-01-01")];

		const withTimesheet = plan({ work: items, rates, includeTimesheet: true });
		expect(withTimesheet.timesheetLines.map((line) => line.text)).toEqual([
			"Timesheet",
			"2026-09-02 · Anna Berg · Website · 1.50 h",
			"2026-09-03 · Ben Ott · Website · 0.83 h",
		]);
		expect(withTimesheet.blockers).toEqual([]);

		expect(withTimesheet.timesheetOmitted).toBe(0);
	});

	it("shortens a timesheet that does not fit the tool's line limit instead of blocking", () => {
		const items = [
			work({ start: "2026-09-02T08:00:00Z", minutes: 90 }),
			work({ start: "2026-09-03T08:00:00Z", minutes: 50 }),
			work({ start: "2026-09-04T08:00:00Z", minutes: 30 }),
		];
		const rates = [rate(PROJECT_A, 10_000, "2026-01-01")];

		// One work line + heading + one period + the note = 4 lines.
		const shortened = plan({ work: items, rates, includeTimesheet: true, maxDraftLines: 4 });
		expect(shortened.blockers).toEqual([]);
		expect(shortened.timesheetLines.map((line) => line.text)).toEqual([
			"Timesheet",
			"2026-09-02 · Anna Berg · Website · 1.50 h",
			"… and 2 more: see the full timesheet",
		]);
		expect(shortened.timesheetOmitted).toBe(2);
		expect(shortened.lines).toHaveLength(1);

		// No room for any period: the timesheet lines are left out entirely.
		const none = plan({ work: items, rates, includeTimesheet: true, maxDraftLines: 3 });
		expect(none.blockers).toEqual([]);
		expect(none.timesheetLines).toEqual([]);
		expect(none.timesheetOmitted).toBe(3);

		// Only work lines beyond the limit block.
		const twoProjects = [
			...items,
			work({
				start: "2026-09-05T08:00:00Z",
				minutes: 30,
				projectId: PROJECT_B,
				projectName: "App",
			}),
		];
		const blocked = plan({
			work: twoProjects,
			rates: [...rates, rate(PROJECT_B, 9_000, "2026-01-01")],
			includeTimesheet: true,
			maxDraftLines: 1,
		});
		expect(blocked.blockers).toEqual([{ kind: "too_many_lines", lines: 2, maxDraftLines: 1 }]);
	});

	it("writes the German shortened-timesheet note", () => {
		const german = planHandOff({
			period: september,
			work: [
				work({ start: "2026-09-02T08:00:00Z", minutes: 90 }),
				work({ start: "2026-09-03T08:00:00Z", minutes: 90 }),
				work({ start: "2026-09-04T08:00:00Z", minutes: 90 }),
			],
			rates: [rate(PROJECT_A, 10_000, "2026-01-01")],
			texts: handOffTextFormat("de"),
			includeTimesheet: true,
			maxDraftLines: 4,
		});
		expect(german.timesheetLines.at(-1)?.text).toBe(
			"… und 2 weitere: siehe vollständigen Stundennachweis",
		);
	});

	it("writes German texts with German dates and decimal commas", () => {
		const german = planHandOff({
			period: september,
			work: [work({ start: "2026-09-02T08:00:00Z", minutes: 90 })],
			rates: [rate(PROJECT_A, 10_000, "2026-01-01")],
			texts: handOffTextFormat("de"),
			includeTimesheet: true,
			maxDraftLines: 300,
		});
		expect(german.lines[0]?.text).toBe("Website, 01.09.2026 – 30.09.2026: 1,50 Std.");
		expect(german.timesheetLines.map((line) => line.text)).toEqual([
			"Stundennachweis",
			"02.09.2026 · Anna Berg · Website · 1,50 Std.",
		]);
		expect(handOffTextFormat("de").title).toBe("Rechnung");
	});
});
