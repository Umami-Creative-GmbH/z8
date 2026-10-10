import type { EmployeeOffboardingState, OffboardingWorkBalance } from "./view-types";

/**
 * The work balance shown in a departing employee's offboarding review (#1002).
 * It is information only: nothing here changes the departure, its follow-up or
 * the release gate.
 *
 * A final overtime payout is offered when the balance is positive and the
 * viewer may record overtime payouts. It defaults to the whole remaining
 * balance, dated the day the shown balance runs through: that is exactly the
 * balance at the end of its day, and the balance views count it at once (a
 * payout dated today only counts from tomorrow). Recording it goes through
 * the overtime payout rules again (#993).
 */
export function offboardingWorkBalance(input: {
	state: EmployeeOffboardingState;
	/** The stored work-balance projection; null while it is not calculated yet. */
	balance: { balanceMinutes: number; computedThroughDate: string } | null;
	mayRecordPayouts: boolean;
	/** Today in the employee's effective timezone (`YYYY-MM-DD`). */
	today: string;
}): OffboardingWorkBalance | null {
	if (input.state === "active") return null;
	if (!input.balance) return { balance: null, finalPayout: null };
	const { balanceMinutes, computedThroughDate } = input.balance;
	return {
		balance: { balanceMinutes, computedThroughDate },
		finalPayout:
			input.mayRecordPayouts && balanceMinutes > 0
				? {
						// ISO dates compare in calendar order.
						defaultDay: computedThroughDate < input.today ? computedThroughDate : input.today,
						defaultMinutes: balanceMinutes,
						latestDay: input.today,
					}
				: null,
	};
}
