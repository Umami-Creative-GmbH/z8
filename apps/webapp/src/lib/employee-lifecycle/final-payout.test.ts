import { describe, expect, it } from "vitest";
import { offboardingWorkBalance } from "./final-payout";

const balance = (balanceMinutes: number) => ({
	balanceMinutes,
	computedThroughDate: "2026-10-09",
});

describe("offboardingWorkBalance", () => {
	it("offers a final payout of the whole remaining balance to a reviewer who may record payouts", () => {
		expect(
			offboardingWorkBalance({
				state: "offboarded",
				balance: balance(360),
				mayRecordPayouts: true,
				today: "2026-10-10",
			}),
		).toEqual({
			balance: { balanceMinutes: 360, computedThroughDate: "2026-10-09" },
			// Dated the day the shown balance runs through, so the default amount is
			// exactly the balance at the end of its day and counts at once.
			finalPayout: { defaultDay: "2026-10-09", defaultMinutes: 360, latestDay: "2026-10-10" },
		});
	});

	it("shows the balance without the action to a reviewer who may not record payouts", () => {
		expect(
			offboardingWorkBalance({
				state: "scheduled",
				balance: balance(360),
				mayRecordPayouts: false,
				today: "2026-10-10",
			}),
		).toEqual({
			balance: { balanceMinutes: 360, computedThroughDate: "2026-10-09" },
			finalPayout: null,
		});
	});

	it("shows a zero or negative balance without the action", () => {
		for (const minutes of [0, -90]) {
			expect(
				offboardingWorkBalance({
					state: "blocked",
					balance: balance(minutes),
					mayRecordPayouts: true,
					today: "2026-10-10",
				}),
			).toEqual({
				balance: { balanceMinutes: minutes, computedThroughDate: "2026-10-09" },
				finalPayout: null,
			});
		}
	});

	it("shows a balance that is not calculated yet without the action", () => {
		expect(
			offboardingWorkBalance({
				state: "legacy_inactive",
				balance: null,
				mayRecordPayouts: true,
				today: "2026-10-10",
			}),
		).toEqual({ balance: null, finalPayout: null });
	});

	it("is not part of the review of an employee who is not departing", () => {
		expect(
			offboardingWorkBalance({
				state: "active",
				balance: balance(360),
				mayRecordPayouts: true,
				today: "2026-10-10",
			}),
		).toBeNull();
	});
});
