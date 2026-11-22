"use client";

import { useQuery } from "@tanstack/react-query";
import { getPayrollReadinessForWorkspaceAction } from "@/app/[locale]/(app)/payroll/actions";
import { PayrollReadinessDashboard } from "@/components/settings/payroll-readiness/payroll-readiness-dashboard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PayrollReadinessResult } from "@/lib/payroll-readiness/get-payroll-readiness";
import { queryKeys } from "@/lib/query/keys";
import type { PayrollTranslate } from "./state";

/**
 * Organization-level payroll readiness checks embedded in `/payroll` Overview for
 * organization administrators (#1957). Never rendered or fetched for delegated
 * payroll officers.
 */
export function PayrollOverviewReadinessSection({
	initialPeriod,
	initialReadiness,
	period,
	t,
}: {
	initialPeriod: { startDate: string; endDate: string };
	initialReadiness?: PayrollReadinessResult | null;
	period: { startDate: string; endDate: string; label: string };
	t: PayrollTranslate;
}) {
	const matchesInitialPeriod =
		Boolean(initialReadiness) &&
		period.startDate === initialPeriod.startDate &&
		period.endDate === initialPeriod.endDate;

	const { data, isLoading, isError } = useQuery({
		queryKey: queryKeys.payroll.readiness({
			startDate: period.startDate,
			endDate: period.endDate,
		}),
		queryFn: async () => {
			const result = await getPayrollReadinessForWorkspaceAction({
				startDate: period.startDate,
				endDate: period.endDate,
			});
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		initialData: matchesInitialPeriod ? (initialReadiness ?? undefined) : undefined,
	});

	return (
		<section
			aria-label={t("settings.payrollReadiness.title", "Payroll Readiness")}
			className="space-y-4"
		>
			<div className="space-y-1">
				<h2 className="font-semibold text-lg tracking-tight">
					{t("settings.payrollReadiness.title", "Payroll Readiness")}
				</h2>
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.payrollReadiness.description",
						"Check whether a payroll period is ready before exporting time, absence, and payroll data.",
					)}
				</p>
			</div>

			{isLoading && !data ? (
				<Card>
					<CardContent className="space-y-4 pt-6">
						<Skeleton aria-hidden="true" className="h-24 w-full" />
						<Skeleton aria-hidden="true" className="h-48 w-full" />
					</CardContent>
				</Card>
			) : isError || !data ? (
				<Card>
					<CardHeader>
						<CardTitle>
							{t("settings.payrollReadiness.title", "Payroll Readiness")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.payrollReadiness.loadError",
								"Organization payroll readiness checks could not be loaded.",
							)}
						</CardDescription>
					</CardHeader>
				</Card>
			) : (
				<PayrollReadinessDashboard t={t} data={data} periodLabel={period.label} />
			)}
		</section>
	);
}
