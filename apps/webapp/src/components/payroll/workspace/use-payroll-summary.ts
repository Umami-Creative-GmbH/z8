"use client";

import { DateTime } from "luxon";
import type React from "react";
import { useEffect, useRef } from "react";
import { getPayrollWorkspaceSummaryAction } from "@/app/[locale]/(app)/payroll/actions";
import type { PayrollDateRangeMode, PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import {
	buildPeriodRequest,
	formatPeriodLabel,
	type PayrollPeriodRequest,
	type PayrollWorkspaceAction,
	type SummaryLoadResult,
} from "./state";

export function useMountedRef() {
	const isMountedRef = useRef(true);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	return isMountedRef;
}

export function usePayrollSummaryLoader({
	dispatch,
	initialRequest,
	isMountedRef,
}: {
	dispatch: React.Dispatch<PayrollWorkspaceAction>;
	initialRequest: PayrollPeriodRequest;
	isMountedRef: React.RefObject<boolean>;
}) {
	const latestRequestRef = useRef(initialRequest);
	const requestGenerationRef = useRef(0);
	useEffect(
		() => () => {
			requestGenerationRef.current += 1;
		},
		[],
	);

	async function loadSummary(
		nextRequest: PayrollPeriodRequest,
		options: {
			onError: (error?: string) => void;
			onSuccess?: () => void;
			preserveDraft?: boolean;
		},
	): Promise<SummaryLoadResult> {
		if (!isMountedRef.current) return { status: "unmounted" };

		latestRequestRef.current = nextRequest;
		const requestGeneration = requestGenerationRef.current + 1;
		requestGenerationRef.current = requestGeneration;

		try {
			const result = await getPayrollWorkspaceSummaryAction(nextRequest);

			if (!isMountedRef.current) return { status: "unmounted" };
			if (requestGeneration !== requestGenerationRef.current) return { status: "stale" };

			if (!result.success) {
				options.onError(result.error);
				return { status: "failed" };
			}

			dispatch({
				type: options.preserveDraft ? "summaryDataRefreshed" : "summaryRefreshed",
				summary: result.data,
			});
			options.onSuccess?.();
			return { status: "applied", summary: result.data };
		} catch {
			if (!isMountedRef.current) return { status: "unmounted" };
			if (requestGeneration !== requestGenerationRef.current) return { status: "stale" };

			options.onError();
			return { status: "failed" };
		}
	}

	function refreshLatestSummary(options: {
		preserveDraft?: boolean;
		onError: (error?: string) => void;
	}): Promise<SummaryLoadResult> {
		return loadSummary(latestRequestRef.current, options);
	}

	return { loadSummary, refreshLatestSummary };
}

/** Switching the date mode, stepping between periods and applying a custom range. */
export function payrollPeriodActions({
	dateMode,
	dispatch,
	endDate,
	filteredEmployeeIds,
	refreshSummary,
	startDate,
	summary,
}: {
	dateMode: PayrollDateRangeMode;
	dispatch: React.Dispatch<PayrollWorkspaceAction>;
	endDate: string;
	filteredEmployeeIds: string[] | undefined;
	refreshSummary: (
		nextRequest: PayrollPeriodRequest,
		employeeIds?: string[],
		onSuccess?: () => void,
	) => void;
	startDate: string;
	summary: PayrollWorkspaceSummary;
}) {
	function applyDateMode(nextMode: PayrollDateRangeMode) {
		if (nextMode === "custom") {
			dispatch({ type: "dateModeChanged", dateMode: nextMode });
			return;
		}

		refreshSummary(
			buildPeriodRequest(DateTime.utc().startOf(nextMode), nextMode),
			filteredEmployeeIds,
			() => dispatch({ type: "dateModeChanged", dateMode: nextMode }),
		);
	}

	function navigatePeriod(direction: "previous" | "next") {
		if (dateMode === "custom") return;

		const currentStart = DateTime.fromISO(summary.period.start, {
			zone: "utc",
		});
		const amount = direction === "previous" ? -1 : 1;
		const nextStart = currentStart.plus({ [dateMode]: amount }).startOf(dateMode);

		refreshSummary(buildPeriodRequest(nextStart, dateMode));
	}

	function returnToCurrentPeriod() {
		if (dateMode === "custom") return;

		refreshSummary(buildPeriodRequest(DateTime.utc().startOf(dateMode), dateMode));
	}

	function applyCustomRange() {
		const start = DateTime.fromISO(startDate);
		const end = DateTime.fromISO(endDate);

		refreshSummary({
			startDate,
			endDate,
			label: formatPeriodLabel(start, end, "custom"),
		});
	}

	return {
		applyCustomRange,
		applyDateMode,
		navigatePeriod,
		returnToCurrentPeriod,
	};
}
