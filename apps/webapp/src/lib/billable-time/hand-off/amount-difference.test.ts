import { describe, expect, it } from "vitest";
import { amountDifferenceOf, type FrozenPricing } from "./amount-difference";
import type { ComparedPiece } from "./comparison";

const acme = { customerId: "c-acme", customerName: "Acme" };
const website = { projectId: "p-web", projectName: "Website" };

/** 90 minutes on Website for Acme, handed off at 100.00 an hour for 150.00. */
const frozen: FrozenPricing = {
	shares: [{ durationMs: 90 * 60_000, rate: "100.00", amount: "150.00" }],
	durationMinutes: 90,
	projectId: "p-web",
	customerId: "c-acme",
	currency: "EUR",
};

const piece = (overrides: Partial<ComparedPiece> = {}): ComparedPiece => ({
	removed: false,
	startedAt: "2026-09-02T08:00:00.000Z",
	endedAt: "2026-09-02T09:30:00.000Z",
	startOffsetMinutes: 120,
	endOffsetMinutes: 120,
	durationMinutes: 90,
	...website,
	...acme,
	billable: true,
	...overrides,
});

describe("amountDifferenceOf", () => {
	it("prices corrected times at the one frozen rate, possibly a few cents off the line", () => {
		const difference = amountDifferenceOf({
			frozen,
			lastResolved: null,
			current: [piece({ endedAt: "2026-09-02T09:45:00.000Z", durationMinutes: 105 })],
		});

		expect(difference).toEqual({
			currency: "EUR",
			fromHandOff: { kind: "known", amount: "25.00", reason: "frozen_rate", roundingCaveat: true },
			sinceResolution: null,
			notOnHandOffForNewCustomer: false,
		});
	});

	it("rounds the change in hours at the frozen rate to cents, half away from zero", () => {
		// 85.50 an hour, 7 minutes less: -9.975 → -9.98.
		const difference = amountDifferenceOf({
			frozen: { ...frozen, shares: [{ durationMs: 90 * 60_000, rate: "85.50", amount: "128.25" }] },
			lastResolved: null,
			current: [piece({ durationMinutes: 83 })],
		});

		expect(difference.fromHandOff).toEqual({
			kind: "known",
			amount: "-9.98",
			reason: "frozen_rate",
			roundingCaveat: true,
		});
	});

	it("can't price corrected times the hand-off split across several rates", () => {
		const acrossRateChange: FrozenPricing = {
			...frozen,
			shares: [
				{ durationMs: 60 * 60_000, rate: "100.00", amount: "100.00" },
				{ durationMs: 30 * 60_000, rate: "120.00", amount: "60.00" },
			],
		};

		const difference = amountDifferenceOf({
			frozen: acrossRateChange,
			lastResolved: null,
			current: [piece({ durationMinutes: 105 })],
		});

		expect(difference.fromHandOff).toEqual({ kind: "unknown", reason: "several_rates" });
	});

	it("has no difference when the hours are unchanged, even across several rates", () => {
		const difference = amountDifferenceOf({
			frozen: {
				...frozen,
				shares: [
					{ durationMs: 60 * 60_000, rate: "100.00", amount: "100.00" },
					{ durationMs: 30 * 60_000, rate: "120.00", amount: "60.00" },
				],
			},
			lastResolved: null,
			// Moved by an hour, same length.
			current: [
				piece({
					startedAt: "2026-09-02T09:00:00.000Z",
					endedAt: "2026-09-02T10:30:00.000Z",
				}),
			],
		});

		expect(difference.fromHandOff).toEqual({
			kind: "known",
			amount: "0.00",
			reason: "frozen_rate",
			roundingCaveat: false,
		});
	});

	it("reverses the whole handed-off amount of removed work", () => {
		const difference = amountDifferenceOf({
			frozen,
			lastResolved: null,
			current: [piece({ removed: true })],
		});

		expect(difference.fromHandOff).toEqual({
			kind: "known",
			amount: "-150.00",
			reason: "removed",
			roundingCaveat: false,
		});
		expect(difference.notOnHandOffForNewCustomer).toBe(false);
	});

	it("reverses the share amounts, not rate × time, across several rates", () => {
		const difference = amountDifferenceOf({
			frozen: {
				...frozen,
				shares: [
					{ durationMs: 60 * 60_000, rate: "100.00", amount: "100.01" },
					{ durationMs: 30 * 60_000, rate: "120.00", amount: "59.99" },
				],
			},
			lastResolved: null,
			current: [piece({ billable: false })],
		});

		expect(difference.fromHandOff).toEqual({
			kind: "known",
			amount: "-160.00",
			reason: "non_billable",
			roundingCaveat: false,
		});
	});

	it("reverses work whose project moved to another customer and warns it is on no hand-off for it", () => {
		const difference = amountDifferenceOf({
			frozen,
			lastResolved: null,
			current: [piece({ customerId: "c-beta", customerName: "Beta" })],
		});

		expect(difference.fromHandOff).toEqual({
			kind: "known",
			amount: "-150.00",
			reason: "customer",
			roundingCaveat: false,
		});
		expect(difference.notOnHandOffForNewCustomer).toBe(true);
	});

	it("reverses work whose project lost its customer, without the new-customer warning", () => {
		const difference = amountDifferenceOf({
			frozen,
			lastResolved: null,
			current: [piece({ customerId: null, customerName: null })],
		});

		expect(difference.fromHandOff).toMatchObject({ amount: "-150.00", reason: "customer" });
		expect(difference.notOnHandOffForNewCustomer).toBe(false);
	});

	it("can't price work moved to another project of the same customer", () => {
		const difference = amountDifferenceOf({
			frozen,
			lastResolved: null,
			current: [piece({ projectId: "p-app", projectName: "App" })],
		});

		expect(difference.fromHandOff).toEqual({ kind: "unknown", reason: "other_project" });
	});

	it("estimates a reversal from rate × duration for shares without a stored amount", () => {
		const difference = amountDifferenceOf({
			// An older row: 85.50 for 90 minutes is 128.25.
			frozen: { ...frozen, shares: [{ durationMs: 90 * 60_000, rate: "85.50" }] },
			lastResolved: null,
			current: [piece({ removed: true })],
		});

		expect(difference.fromHandOff).toEqual({
			kind: "estimated",
			amount: "-128.25",
			reason: "removed",
			roundingCaveat: false,
		});
	});

	it("prices the split pieces still on the project; a non-billable piece leaves the invoice", () => {
		const difference = amountDifferenceOf({
			frozen,
			lastResolved: null,
			current: [
				piece({ endedAt: "2026-09-02T09:00:00.000Z", durationMinutes: 60 }),
				piece({ startedAt: "2026-09-02T09:00:00.000Z", durationMinutes: 30, billable: false }),
			],
		});

		expect(difference.fromHandOff).toEqual({
			kind: "known",
			amount: "-50.00",
			reason: "frozen_rate",
			roundingCaveat: true,
		});
	});

	it("can't price a piece that is still running", () => {
		const difference = amountDifferenceOf({
			frozen,
			lastResolved: null,
			current: [piece({ endedAt: null, durationMinutes: null })],
		});

		expect(difference.fromHandOff).toEqual({ kind: "unknown", reason: "running" });
	});

	it("can't price an item handed off without shares", () => {
		const difference = amountDifferenceOf({
			frozen: { ...frozen, shares: [] },
			lastResolved: null,
			current: [piece({ removed: true })],
		});

		expect(difference.fromHandOff).toEqual({ kind: "unknown", reason: "no_frozen_rate" });
	});

	describe("after a resolution", () => {
		it("also shows the difference against the last resolved values", () => {
			// Resolved at 105 minutes (+25.00, handled), now corrected to 120 minutes.
			const difference = amountDifferenceOf({
				frozen,
				lastResolved: [piece({ durationMinutes: 105 })],
				current: [piece({ durationMinutes: 120 })],
			});

			expect(difference.fromHandOff).toMatchObject({ kind: "known", amount: "50.00" });
			expect(difference.sinceResolution).toEqual({
				kind: "known",
				amount: "25.00",
				reason: "frozen_rate",
				roundingCaveat: true,
			});
		});

		it("rounds the difference since the resolution once", () => {
			// 85.50 an hour: +7 minutes resolved (9.975), now +14 (19.95): 9.975 more.
			const at8550: FrozenPricing = {
				...frozen,
				shares: [{ durationMs: 90 * 60_000, rate: "85.50", amount: "128.25" }],
			};
			const difference = amountDifferenceOf({
				frozen: at8550,
				lastResolved: [piece({ durationMinutes: 97 })],
				current: [piece({ durationMinutes: 104 })],
			});

			expect(difference.fromHandOff).toMatchObject({ amount: "19.95" });
			expect(difference.sinceResolution).toMatchObject({ amount: "9.98" });
		});

		it("doesn't count a reversal twice", () => {
			const difference = amountDifferenceOf({
				frozen: { ...frozen, shares: [{ durationMs: 90 * 60_000, rate: "100.00" }] },
				lastResolved: [piece({ removed: true })],
				current: [piece({ removed: true })],
			});

			expect(difference.fromHandOff).toMatchObject({ kind: "estimated", amount: "-150.00" });
			expect(difference.sinceResolution).toEqual({
				kind: "known",
				amount: "0.00",
				reason: "removed",
				roundingCaveat: false,
			});
		});

		it("reverses what remained after the resolution when the work is removed later", () => {
			const difference = amountDifferenceOf({
				frozen,
				lastResolved: [piece({ durationMinutes: 60 })],
				current: [piece({ removed: true })],
			});

			// The resolution handled -50.00; the remaining 100.00 reverses now.
			expect(difference.sinceResolution).toEqual({
				kind: "known",
				amount: "-100.00",
				reason: "removed",
				roundingCaveat: true,
			});
		});

		it("is unknown when either side can't be priced", () => {
			const difference = amountDifferenceOf({
				frozen,
				lastResolved: [piece({ projectId: "p-app", projectName: "App" })],
				current: [piece({ projectId: "p-app", projectName: "App", durationMinutes: 120 })],
			});

			expect(difference.fromHandOff).toEqual({ kind: "unknown", reason: "other_project" });
			expect(difference.sinceResolution).toEqual({ kind: "unknown", reason: "other_project" });
		});
	});
});
