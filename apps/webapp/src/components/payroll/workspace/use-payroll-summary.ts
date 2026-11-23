"use client";

import type React from "react";
import { useEffect, useRef } from "react";
import { Temporal } from "temporal-polyfill";
import { getPayrollWorkspaceSummaryAction } from "@/app/[locale]/(app)/payroll/actions";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { PayrollDateRangeMode, PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import {
	buildPeriodRequest,
	formatPeriodLabel,
	type PayrollPeriodRequest,
	type PayrollWorkspaceAction,
	type SummaryLoadResult,
	startOfPayrollPeriod,
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
	locale = "en",
	refreshSummary,
	startDate,
	summary,
}: {
	dateMode: PayrollDateRangeMode;
	dispatch: React.Dispatch<PayrollWorkspaceAction>;
	endDate: string;
	filteredEmployeeIds: string[] | undefined;
	locale?: string;
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
			buildPeriodRequest(
				startOfPayrollPeriod(Temporal.Now.plainDateISO("UTC"), nextMode),
				nextMode,
				locale,
			),
			filteredEmployeeIds,
			() => dispatch({ type: "dateModeChanged", dateMode: nextMode }),
		);
	}

	function navigatePeriod(direction: "previous" | "next") {
		if (dateMode === "custom") return;

		const currentStart = parsePlainDate(summary.period.start);
		const amount = direction === "previous" ? -1 : 1;
		const nextStart =
			dateMode === "month"
				? startOfPayrollPeriod(currentStart.add({ months: amount }), "month")
				: startOfPayrollPeriod(currentStart.add({ weeks: amount }), "week");

		refreshSummary(buildPeriodRequest(nextStart, dateMode, locale));
	}

	function returnToCurrentPeriod() {
		if (dateMode === "custom") return;

		refreshSummary(
			buildPeriodRequest(
				startOfPayrollPeriod(Temporal.Now.plainDateISO("UTC"), dateMode),
				dateMode,
				locale,
			),
		);
	}

	function applyCustomRange() {
		let label = `${startDate} - ${endDate}`;
		try {
			const start = parsePlainDate(startDate);
			const end = parsePlainDate(endDate);
			label = formatPeriodLabel(start, end, "custom", locale);
		} catch {
			// Let the server action return its validation error when a date input is blank or malformed.
		}

		refreshSummary({
			startDate,
			endDate,
			label,
		});
	}

	return {
		applyCustomRange,
		applyDateMode,
		navigatePeriod,
		returnToCurrentPeriod,
	};
}
