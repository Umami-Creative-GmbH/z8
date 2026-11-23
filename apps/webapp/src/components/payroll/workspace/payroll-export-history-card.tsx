"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import {
	discardScopedPayrollRunAction,
	getPayrollExportDownloadUrlAction,
	getPayrollExportHistoryAction,
} from "@/app/[locale]/(app)/payroll/actions";
import { ExportHistory } from "@/components/settings/payroll-export/export-history";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query/keys";

/**
 * Scoped payroll export history on the `/payroll` Export tab (#1957).
 * Org admins see all organization exports; delegated payroll officers see only
 * exports whose covered employees stay inside their active grant scope.
 */
export function PayrollExportHistoryCard() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const { data, isLoading, isError } = useQuery({
		queryKey: queryKeys.payroll.exportHistory(),
		queryFn: async () => {
			const result = await getPayrollExportHistoryAction();
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
	});

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.payrollExport.history.title", "Export History")}</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.history.descriptionAllFormats",
							"View and download previous payroll exports",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Skeleton aria-hidden="true" className="h-32 w-full" />
				</CardContent>
			</Card>
		);
	}

	if (isError || !data) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.payrollExport.history.title", "Export History")}</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.history.loadError",
							"Export history could not be loaded.",
						)}
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<ExportHistory
			exports={data.exports}
			organizationTimezone={data.organizationTimezone}
			getDownloadUrl={(jobId) => getPayrollExportDownloadUrlAction(jobId)}
			discardPayrollRun={async (jobId) => {
				const result = await discardScopedPayrollRunAction(jobId);
				if (result.success && result.data.status === "discarded") {
					void queryClient.invalidateQueries({ queryKey: queryKeys.payroll.exportHistory() });
					void queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.payrollRuns() });
				}
				return result;
			}}
		/>
	);
}
