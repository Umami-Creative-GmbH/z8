"use client";

import { IconCalendarStats, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { dismissWorkingWeekNoticeAction } from "@/app/[locale]/(app)/settings/vacation/working-week-notice-actions";
import {
	OverdrawnVacationBadge,
	VacationAllowanceExplanation,
} from "@/components/absences/vacation-allowance-explanation";
import { VacationPolicyConfigurationMessage } from "@/components/absences/vacation-policy-configuration-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	WORKING_WEEK_NOTICE_YEAR,
	type WorkingWeekNoticeRow,
} from "@/lib/absences/working-week-notice";
import { Link } from "@/navigation";

/**
 * The one-time list of employees whose 2026 allowance the working-week conversion reduces
 * (Absences ADR 0003), for owners and admins. Dismissing it hides it for every owner and admin of
 * the organization, for good.
 */
export function WorkingWeekNotice({ rows }: { rows: WorkingWeekNoticeRow[] }) {
	const { t } = useTranslate();
	const [dismissed, setDismissed] = useState(false);
	const [isPending, startTransition] = useTransition();

	if (dismissed || rows.length === 0) return null;

	function dismiss() {
		startTransition(async () => {
			const result = await dismissWorkingWeekNoticeAction();
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			setDismissed(true);
			toast.success(
				t(
					"settings.vacation.workingWeekNotice.dismissed",
					"The notice is dismissed for every owner and admin",
				),
			);
		});
	}

	const days = (value: number | null) =>
		value === null
			? "—"
			: t(
					"settings.vacation.workingWeekNotice.days",
					"{days, plural, one {# day} other {# days}}",
					{
						days: value,
					},
				);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCalendarStats aria-hidden="true" className="size-5" />
					{t(
						"settings.vacation.workingWeekNotice.title",
						"2026 vacation allowances now follow working days per week",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.vacation.workingWeekNotice.description",
						"Policy allowances are stated for a five-day week and now convert to each employee's scheduled working days per week. These employees work fewer days, so their 2026 allowance is lower. Employees with a custom allowance keep it and aren't listed. Overdrawn vacation is shown, never reclaimed, and existing requests stay unchanged.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<Table mobileLayout="stacked">
					<TableHeader>
						<TableRow>
							<TableHead>{t("settings.vacation.workingWeekNotice.employee", "Employee")}</TableHead>
							<TableHead className="text-right">
								{t("settings.vacation.workingWeekNotice.referenceAllowance", "Five-day allowance")}
							</TableHead>
							<TableHead className="text-right">
								{t(
									"settings.vacation.workingWeekNotice.convertedAllowance",
									"Working-week allowance",
								)}
							</TableHead>
							<TableHead className="text-right">
								{t("settings.vacation.workingWeekNotice.overdrawn", "Overdrawn")}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.employeeId}>
								<TableCell>
									<Link
										href={`/settings/vacation/employees/${row.employeeId}`}
										className="font-medium underline-offset-4 hover:underline"
									>
										{row.name}
									</Link>
									<VacationPolicyConfigurationMessage
										configuration={row.configuration}
										className="mt-1 text-xs text-muted-foreground"
									/>
									<VacationAllowanceExplanation
										allowance={row.allowance ?? undefined}
										year={WORKING_WEEK_NOTICE_YEAR}
										className="mt-1 text-xs"
									/>
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{days(row.referenceAllowance)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{days(row.convertedAllowance)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{row.overdrawnDays === null ? (
										"—"
									) : row.overdrawnDays > 0 ? (
										<OverdrawnVacationBadge overdrawnDays={row.overdrawnDays} />
									) : (
										<span className="text-muted-foreground">
											{t("settings.vacation.workingWeekNotice.notOverdrawn", "None")}
										</span>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				<div className="flex justify-end">
					<Button type="button" variant="outline" onClick={dismiss} disabled={isPending}>
						{isPending ? (
							<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
						) : (
							<IconX aria-hidden="true" className="size-4" />
						)}
						{t("settings.vacation.workingWeekNotice.dismiss", "Dismiss for everyone")}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
