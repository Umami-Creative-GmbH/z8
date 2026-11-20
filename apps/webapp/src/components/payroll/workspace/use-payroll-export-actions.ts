"use client";

import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
	exportPayrollPdfAction,
	startScopedPayrollExportAction,
} from "@/app/[locale]/(app)/payroll/actions";
import { queryKeys } from "@/lib/query/keys";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";

/**
 * The PDF download and the payroll export for the current request. It lives at the
 * workspace root, so switching tabs never drops a running export.
 */
export function usePayrollExportActions({
	filtersHaveNoMatches,
	formatId,
	request,
	startTransition,
	t,
}: {
	filtersHaveNoMatches: boolean;
	formatId: string;
	request: PayrollPeriodRequest;
	startTransition: React.TransitionStartFunction;
	t: PayrollTranslate;
}) {
	const queryClient = useQueryClient();
	const lifetime = useRef(0);
	useEffect(
		() => () => {
			lifetime.current += 1;
		},
		[],
	);

	function downloadPdf() {
		if (filtersHaveNoMatches) {
			toast.error(
				t(
					"payroll.filters.noMatchingEmployees",
					"No employees match the selected payroll filters.",
				),
			);
			return;
		}

		startTransition(async () => {
			const generation = lifetime.current;
			const result = await exportPayrollPdfAction(request).catch(() => ({
				success: false as const,
				error: t("payroll.errors.actionFailed", "Payroll workspace action failed"),
			}));
			if (generation !== lifetime.current) return;

			if (!result.success) {
				toast.error(result.error);
				return;
			}

			const blob = new Blob([new Uint8Array(result.data.data)], {
				type: "application/pdf",
			});
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = result.data.filename;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		});
	}

	function triggerExport() {
		if (!formatId) return;
		if (filtersHaveNoMatches) {
			toast.error(
				t(
					"payroll.filters.noMatchingEmployees",
					"No employees match the selected payroll filters.",
				),
			);
			return;
		}

		startTransition(async () => {
			const generation = lifetime.current;
			const result = await startScopedPayrollExportAction({
				...request,
				formatId,
			}).catch(() => ({
				success: false as const,
				error: t("payroll.errors.actionFailed", "Payroll workspace action failed"),
			}));
			if (generation !== lifetime.current) return;

			if (!result.success) {
				toast.error(result.error);
				return;
			}

			toast.success(
				result.data.isAsync
					? t("payroll.export.queued", "Payroll export queued")
					: t("payroll.export.completed", "Payroll export completed"),
			);
			if (result.data.unmappedOvertimePayoutCount) {
				toast.warning(
					t(
						"payroll.export.unmappedOvertimePayouts",
						"{count, plural, one {# overtime payout was} other {# overtime payouts were}} not exported",
						{ count: result.data.unmappedOvertimePayoutCount },
					),
					{
						description: t(
							"payroll.export.unmappedOvertimePayoutsDescription",
							"No wage type is mapped to Overtime for this format. Ask an organization administrator to map one, or pay these hours out another way.",
						),
					},
				);
			}
			void queryClient.invalidateQueries({
				queryKey: ["payroll", "baselines"],
			});
			void queryClient.invalidateQueries({
				queryKey: ["payroll", "comparisonBaselines"],
			});
			// A payroll run may now include expense reports (#852), which changes readiness (#854).
			void queryClient.invalidateQueries({
				queryKey: queryKeys.travelExpenses.payrollRuns(),
			});
		});
	}

	return { downloadPdf, triggerExport };
}
