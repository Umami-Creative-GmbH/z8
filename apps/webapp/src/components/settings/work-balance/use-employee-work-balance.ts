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
	ConflictingPayout,
} from "@/lib/work-balance/adjustments/types";

export const EMPLOYEE_WORK_BALANCE_QUERY_KEY = ["employeeWorkBalanceSection"] as const;

export class BalanceAdjustmentActionError extends Error {
	constructor(
		readonly code: BalanceAdjustmentErrorCode | null,
		/** With `conflicting_payouts` (#997): the payouts that keep the opening balance out. */
		readonly conflictingPayouts: ConflictingPayout[] = [],
	) {
		super(code ?? "failed");
	}
}

async function unwrap<T>(action: Promise<BalanceAdjustmentActionResult<T>>): Promise<T> {
	const result = await action.catch(() => null);
	if (!result) throw new BalanceAdjustmentActionError(null);
	if (!result.success) {
		throw new BalanceAdjustmentActionError(result.code, result.conflictingPayouts ?? []);
	}
	return result.data;
}

/** The employee's Work balance section data and its writes (#993, #997). */
export function useEmployeeWorkBalance(employeeId: string) {
	const queryClient = useQueryClient();
	const queryKey = [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employeeId];
	const section = useQuery({
		queryKey,
		queryFn: () => unwrap(getEmployeeWorkBalanceSectionAction({ employeeId })),
	});
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
