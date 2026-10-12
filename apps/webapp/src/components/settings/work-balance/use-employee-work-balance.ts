"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CancelBalanceAdjustmentInput,
	cancelBalanceAdjustmentAction,
	getEmployeeWorkBalanceSectionAction,
	type RecordOvertimePayoutInput,
	recordOvertimePayoutAction,
	type SetOpeningBalanceInput,
	setOpeningBalanceAction,
} from "@/app/[locale]/(app)/settings/employees/work-balance-actions";
import type {
	BalanceAdjustmentActionResult,
	BalanceAdjustmentErrorCode,
	BalanceAdjustmentRefusalDetails,
	ConflictingPayout,
} from "@/lib/work-balance/adjustments/types";

export const EMPLOYEE_WORK_BALANCE_QUERY_KEY = ["employeeWorkBalanceSection"] as const;

export class BalanceAdjustmentActionError extends Error {
	/** With `conflicting_payouts` (#997): the payouts that keep the opening balance out. */
	readonly conflictingPayouts: ConflictingPayout[];
	/** With `month_closed` (#762): the closed month (`YYYY-MM`) the day lies in. */
	readonly closedMonth: string | null;

	constructor(
		readonly code: BalanceAdjustmentErrorCode | null,
		details: BalanceAdjustmentRefusalDetails = {},
	) {
		super(code ?? "failed");
		this.conflictingPayouts = details.conflictingPayouts ?? [];
		this.closedMonth = details.closedMonth ?? null;
	}
}

/** A refusal the user cannot change by retrying, as opposed to an unexpected failure. */
export function isRefusal(error: unknown): error is BalanceAdjustmentActionError {
	return (
		error instanceof BalanceAdjustmentActionError && error.code !== null && error.code !== "failed"
	);
}

async function unwrap<T>(action: Promise<BalanceAdjustmentActionResult<T>>): Promise<T> {
	const result = await action.catch(() => null);
	if (!result) throw new BalanceAdjustmentActionError(null);
	if (!result.success) {
		throw new BalanceAdjustmentActionError(result.code, {
			conflictingPayouts: result.conflictingPayouts,
			closedMonth: result.closedMonth,
		});
	}
	return result.data;
}

/**
 * The employee's balance and balance adjustment history, as the employee, their
 * managers or an owner/admin may see it (#996). Shares its cache with the
 * Work balance section, so a record or cancel refreshes every view of it.
 */
export function useBalanceAdjustmentSection(employeeId: string) {
	return useQuery({
		queryKey: [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employeeId],
		queryFn: () => unwrap(getEmployeeWorkBalanceSectionAction({ employeeId })),
		// A refusal (not permitted, not found) does not change on retry.
		retry: (failureCount, error) => !isRefusal(error) && failureCount < 3,
	});
}

/** The employee's Work balance section data and its writes (#993, #997). */
export function useEmployeeWorkBalance(employeeId: string) {
	const queryClient = useQueryClient();
	const queryKey = [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employeeId];
	const section = useBalanceAdjustmentSection(employeeId);
	const onSettled = () => queryClient.invalidateQueries({ queryKey });

	const recordPayout = useMutation({
		mutationFn: (input: Omit<RecordOvertimePayoutInput, "employeeId">) =>
			unwrap(recordOvertimePayoutAction({ ...input, employeeId })),
		onSettled,
	});
	const setOpeningBalance = useMutation({
		mutationFn: (input: Omit<SetOpeningBalanceInput, "employeeId">) =>
			unwrap(setOpeningBalanceAction({ ...input, employeeId })),
		onSettled,
	});
	const cancelAdjustment = useMutation({
		mutationFn: (input: Omit<CancelBalanceAdjustmentInput, "employeeId">) =>
			unwrap(cancelBalanceAdjustmentAction({ ...input, employeeId })),
		onSettled,
	});

	return { section, recordPayout, setOpeningBalance, cancelAdjustment };
}

/**
 * Records an overtime payout from outside the Work balance section, such as
 * the final payout in the offboarding review (#1002). The section refreshes
 * too; `onSettled` refreshes the caller's own view.
 */
export function useRecordOvertimePayout(employeeId: string, onSettled?: () => Promise<unknown>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: Omit<RecordOvertimePayoutInput, "employeeId">) =>
			unwrap(recordOvertimePayoutAction({ ...input, employeeId })),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employeeId],
				}),
				onSettled?.(),
			]),
	});
}
