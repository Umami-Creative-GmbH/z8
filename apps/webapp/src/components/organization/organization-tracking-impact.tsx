"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { TrackingDateImpact } from "@/lib/time-tracking/tracking-date-review-types";
import { Link } from "@/navigation";

export function OrganizationTrackingImpact({ impact }: { impact: TrackingDateImpact }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const hours = (minutes: number) =>
		new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
			minutes / 60,
		);
	return (
		<section
			className="space-y-4"
			aria-label={t("organization.tracking.review-title", "Tracking date impact review")}
		>
			<p className="text-sm text-muted-foreground">
				{t(
					"organization.tracking.review-explanation",
					"Review the effective dates, required hours and work balances below. Employment dates and vacation allowances stay unchanged. Balances run through the last completed day in each employee’s timezone.",
				)}
			</p>
			{impact.blockers.length > 0 ? (
				<div role="alert" className="rounded-md border border-destructive p-3 text-sm">
					<p>
						{t(
							"organization.tracking.closed-blockers",
							"Resolve the issues below before generating a new preview and saving.",
						)}
					</p>
					<ul className="mt-2 list-disc pl-5">
						{impact.blockers.map((blocker) => (
							<li
								key={`${blocker.employeeId}:${blocker.kind}:${blocker.kind === "month_closed" ? blocker.month : blocker.exceptionDate}`}
							>
								{
									impact.employees.find((row) => row.employeeId === blocker.employeeId)
										?.employeeName
								}{" "}
								—{" "}
								{blocker.kind === "month_closed"
									? blocker.month
									: t(
											"organization.tracking.exception-conflict",
											"Employee exception {exception} precedes the new minimum {minimum}. Remove or change the employee exception first.",
											{ exception: blocker.exceptionDate, minimum: blocker.minimumDate },
										)}
							</li>
						))}
					</ul>
					{impact.blockers.some((blocker) => blocker.kind === "month_closed") ? (
						<Link href="/settings/closed-months" className="mt-2 inline-block underline">
							{t("organization.tracking.closed-settings", "Open closed-month settings")}
						</Link>
					) : null}
				</div>
			) : null}
			{impact.employees.length === 0 ? (
				<p className="text-sm">
					{t("organization.tracking.no-employees", "No employee balances are affected.")}
				</p>
			) : null}
			<section
				className="space-y-4"
				aria-label={t("organization.tracking.employee-impacts", "Employee balance impacts")}
			>
				{impact.employees.map((row) => (
					<article key={row.employeeId} className="space-y-3 rounded-md border p-4">
						<h3 className="font-medium">{row.employeeName}</h3>
						<dl className="grid gap-1 text-sm sm:grid-cols-2">
							<div>
								<dt className="text-muted-foreground">
									{t("organization.tracking.old-boundary", "Current calculation start")}
								</dt>
								<dd>
									{row.oldBoundary ??
										t("organization.tracking.no-boundary", "No calculation start")}
								</dd>
							</div>
							<div>
								<dt className="text-muted-foreground">
									{t("organization.tracking.proposed-boundary", "Proposed tracking start")}
								</dt>
								<dd>{row.proposedBoundary}</dd>
							</div>
							<div>
								<dt className="text-muted-foreground">
									{t("organization.tracking.employee-zone", "Employee timezone")}
								</dt>
								<dd>{row.timezone}</dd>
							</div>
							<div>
								<dt className="text-muted-foreground">
									{t("organization.tracking.through-date", "Balances through")}
								</dt>
								<dd>{row.throughDate}</dd>
							</div>
						</dl>
						<table className="w-full text-left text-sm tabular-nums">
							<caption className="sr-only">
								{t("organization.tracking.hours-caption", "Before and after hours")}
							</caption>
							<thead>
								<tr>
									<th scope="col" className="py-1">
										{t("organization.tracking.hours", "Hours")}
									</th>
									<th scope="col">{t("organization.tracking.before", "Before")}</th>
									<th scope="col">{t("organization.tracking.after", "After")}</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<th scope="row" className="py-1 font-normal">
										{t("organization.tracking.actual", "Completed work")}
									</th>
									<td>{hours(row.before.actualMinutes)}</td>
									<td>{hours(row.after.actualMinutes)}</td>
								</tr>
								<tr>
									<th scope="row" className="py-1 font-normal">
										{t("organization.tracking.required", "Required time")}
									</th>
									<td>{hours(row.before.requiredMinutes)}</td>
									<td>{hours(row.after.requiredMinutes)}</td>
								</tr>
								<tr>
									<th scope="row" className="py-1 font-medium">
										{t("organization.tracking.balance", "Work balance")}
									</th>
									<td>{hours(row.before.balanceMinutes)}</td>
									<td>{hours(row.after.balanceMinutes)}</td>
								</tr>
							</tbody>
						</table>
						{row.openingBalance ? (
							<p className="text-sm text-muted-foreground">
								{t("organization.tracking.opening-preserved", "Opening balance preserved:")}{" "}
								{row.openingBalance.day} · {hours(row.openingBalance.minutes)}{" "}
								{t("organization.tracking.hour-unit", "hours")}
							</p>
						) : null}
						{row.vacation.map((vacation) => (
							<p key={vacation.year} className="text-sm text-muted-foreground">
								{vacation.year} ·{" "}
								{t(
									"organization.tracking.vacation-unchanged",
									"Vacation allowance and balance unchanged:",
								)}{" "}
								{vacation.allowanceDays} / {vacation.remainingDays}{" "}
								{t("organization.tracking.day-unit", "days")}
							</p>
						))}
						{row.periods.length > 0 ? (
							<details className="text-sm">
								<summary className="cursor-pointer text-primary">
									{t("organization.tracking.affected-periods", "Affected months")}
								</summary>
								<ul className="mt-2 space-y-2">
									{row.periods.map((period) => (
										<li key={period.month} className="rounded bg-muted/40 p-2">
											<span className="font-medium">{period.month}</span> ({period.timezone}){" "}
											{period.closed ? t("organization.tracking.closed", "Closed") : ""}
											<p>
												{t("organization.tracking.required", "Required time")}:{" "}
												{hours(period.before.requiredMinutes)} →{" "}
												{hours(period.after.requiredMinutes)} ·{" "}
												{t("organization.tracking.actual", "Completed work")}:{" "}
												{hours(period.before.actualMinutes)} → {hours(period.after.actualMinutes)} ·{" "}
												{t("organization.tracking.ending-balance", "Balance at month end")}:{" "}
												{hours(period.before.balanceMinutes)} → {hours(period.after.balanceMinutes)}
											</p>
										</li>
									))}
								</ul>
							</details>
						) : (
							<p className="text-sm text-muted-foreground">
								{t(
									"organization.tracking.no-changed-periods",
									"No completed-month results change.",
								)}
							</p>
						)}
					</article>
				))}
			</section>
		</section>
	);
}
