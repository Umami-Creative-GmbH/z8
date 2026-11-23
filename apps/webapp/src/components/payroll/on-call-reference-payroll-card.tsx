"use client";

import { IconPhoneCall } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { listOnCallPayrollReferenceRowsAction } from "@/app/[locale]/(app)/settings/contracts/on-call-actions";
import { OnCallReferenceBreakdownView } from "@/components/statutory/on-call/on-call-reference-breakdown";
import { formatOnCallMinutes } from "@/components/statutory/on-call/on-call-text";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import type { OnCallReferenceMethod } from "@/lib/statutory/on-call/reference-period";
import type { OnCallPayrollRefusal } from "@/lib/statutory/on-call/views";

const payrollRefusals: RefusalMessages<OnCallPayrollRefusal> = {
	on_call_payroll_range_too_long: [
		"common.onCall.payroll.rangeTooLong",
		"Reference hours are listed for at most three months at a time. Choose a shorter period.",
	],
};

/**
 * Payroll preparation (#1992): every on-call employee's sick-leave start and public holiday in the
 * payroll period with its § 12 Abs. 4–5 TzBfG reference hours. Read-only figures for whoever
 * prepares the export; it never changes settled days or closed months. Renders nothing when the
 * period has no such events.
 */
export function OnCallReferencePayrollCard({
	organizationId,
	startDate,
	endDate,
}: {
	/** Part of the query key: cached rows never show under another organization. */
	readonly organizationId: string;
	readonly startDate: string;
	readonly endDate: string;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const [method, setMethod] = useState<OnCallReferenceMethod>("three_months");
	const [openRow, setOpenRow] = useState<string | null>(null);
	const rows = useQuery({
		queryKey: ["payroll", "on-call-reference", organizationId, startDate, endDate, method],
		queryFn: async () => {
			const result = await listOnCallPayrollReferenceRowsAction({ startDate, endDate, method });
			if (!result.success) throw new Error(actionErrorMessage(t, result, payrollRefusals));
			return result.data;
		},
	});

	if (rows.isPending || (rows.isSuccess && rows.data.length === 0)) return null;
	const day = (value: string) => formatPlainDate(parsePlainDate(value), locale, "dateMedium");

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconPhoneCall aria-hidden="true" className="size-5" />
					{t("common.onCall.payroll.title", "On-call reference hours (§ 12 TzBfG)")}
				</CardTitle>
				<CardDescription>
					{t(
						"common.onCall.payroll.description",
						"Average working time before each sick leave or public holiday of on-call employees in this period, to prepare continued pay. Nothing here changes settled days.",
					)}
				</CardDescription>
				<div className="flex gap-1" role="group">
					<Button
						type="button"
						size="sm"
						variant={method === "three_months" ? "secondary" : "ghost"}
						aria-pressed={method === "three_months"}
						onClick={() => setMethod("three_months")}
					>
						{t("common.onCall.reference.threeMonths", "3 months")}
					</Button>
					<Button
						type="button"
						size="sm"
						variant={method === "thirteen_weeks" ? "secondary" : "ghost"}
						aria-pressed={method === "thirteen_weeks"}
						onClick={() => setMethod("thirteen_weeks")}
					>
						{t("common.onCall.reference.thirteenWeeks", "13 weeks")}
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{rows.isError ? (
					<p role="alert" className="text-destructive text-sm">
						{rows.error.message}
					</p>
				) : (
					<ul className="space-y-2">
						{rows.data.map((row) => {
							const key = `${row.employeeId}-${row.kind}-${row.eventDate}`;
							const open = openRow === key;
							return (
								<li key={key} className="rounded-lg border p-3">
									<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
										<span>
											<span className="font-medium">{row.employeeName}</span>{" "}
											{row.kind === "sick_leave"
												? t("common.onCall.reference.sickLeave", "Sick leave from {date}", {
														date: day(row.eventDate),
													})
												: t("common.onCall.reference.publicHoliday", "Public holiday on {date}", {
														date: day(row.eventDate),
													})}
										</span>
										<span className="tabular-nums">
											{t("common.onCall.payroll.perDay", "{duration} per day", {
												duration:
													row.breakdown.averageMinutesPerDay === null
														? "—"
														: formatOnCallMinutes(row.breakdown.averageMinutesPerDay),
											})}
										</span>
										<Button
											type="button"
											size="sm"
											variant="ghost"
											aria-expanded={open}
											onClick={() => setOpenRow(open ? null : key)}
										>
											{open
												? t("common.onCall.payroll.hide", "Hide breakdown")
												: t("common.onCall.payroll.show", "Show breakdown")}
										</Button>
									</div>
									{row.paidSickDays ? (
										<p className="text-muted-foreground mt-1 text-sm">
											{t(
												"common.onCall.payroll.paidSickDays",
												"Sick pay for {days, plural, one {# day} other {# days}} in this period",
												{ days: row.paidSickDays.days },
											)}
											{row.paidSickDays.holidaysPaidSeparately.length > 0
												? ` · ${t(
														"common.onCall.payroll.holidaysPaidSeparately",
														"Public holidays during the illness are paid as their own rows, not as sick days: {dates}",
														{
															dates: row.paidSickDays.holidaysPaidSeparately.map(day).join(", "),
														},
													)}`
												: null}
										</p>
									) : null}
									{open ? (
										<div className="mt-3">
											<OnCallReferenceBreakdownView breakdown={row.breakdown} />
										</div>
									) : null}
								</li>
							);
						})}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
