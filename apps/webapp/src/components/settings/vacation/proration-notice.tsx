"use client";

import { IconCalendarStats, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { dismissProrationNoticeAction } from "@/app/[locale]/(app)/settings/vacation/proration-notice-actions";
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
import type { ProrationNoticeRow } from "@/lib/absences/proration-notice";
import { Link } from "@/navigation";

/**
 * The one-time list of employees whose 2026 allowance is now prorated (#1112), for owners and
 * admins. Dismissing it hides it for every owner and admin of the organization, for good.
 */
export function ProrationNotice({ rows }: { rows: ProrationNoticeRow[] }) {
	const { t } = useTranslate();
	const [dismissed, setDismissed] = useState(false);
	const [isPending, startTransition] = useTransition();

	if (dismissed || rows.length === 0) return null;

	function dismiss() {
		startTransition(async () => {
			const result = await dismissProrationNoticeAction();
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			setDismissed(true);
			toast.success(
				t(
					"settings.vacation.prorationNotice.dismissed",
					"The notice is dismissed for every owner and admin",
				),
			);
		});
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCalendarStats aria-hidden="true" className="size-5" />
					{t(
						"settings.vacation.prorationNotice.title",
						"2026 vacation allowances are now prorated",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.vacation.prorationNotice.description",
						"These employees join or leave during 2026, so their 2026 allowance now counts only their full employment months. Employees with a custom allowance keep it and aren't listed. Overdrawn vacation is shown, never reclaimed.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("settings.vacation.prorationNotice.employee", "Employee")}</TableHead>
							<TableHead className="text-right">
								{t("settings.vacation.prorationNotice.fullAllowance", "Full allowance")}
							</TableHead>
							<TableHead className="text-right">
								{t("settings.vacation.prorationNotice.proratedAllowance", "Prorated allowance")}
							</TableHead>
							<TableHead className="text-right">
								{t("settings.vacation.prorationNotice.overdrawn", "Overdrawn")}
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
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{t(
										"settings.vacation.prorationNotice.days",
										"{days, plural, one {# day} other {# days}}",
										{
											days: row.fullAllowance,
										},
									)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{t(
										"settings.vacation.prorationNotice.days",
										"{days, plural, one {# day} other {# days}}",
										{
											days: row.proratedAllowance,
										},
									)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{row.overdrawnDays > 0 ? (
										<span className="font-medium text-destructive">
											{t(
												"settings.vacation.prorationNotice.days",
												"{days, plural, one {# day} other {# days}}",
												{ days: row.overdrawnDays },
											)}
										</span>
									) : (
										<span className="text-muted-foreground">
											{t("settings.vacation.prorationNotice.notOverdrawn", "None")}
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
						{t("settings.vacation.prorationNotice.dismiss", "Dismiss for everyone")}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
