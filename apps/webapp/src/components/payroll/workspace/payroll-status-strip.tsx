"use client";

import { IconUsers } from "@tabler/icons-react";
import type React from "react";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import { formatHours, type PayrollTranslate } from "./state";

/** The compact strip of period figures: employees, worked hours, readiness and blockers. */
export function PayrollStatusStrip({
	blockersSummaryRef,
	children,
	displayedTotals,
	readyEmployeeCount,
	t,
}: {
	blockersSummaryRef: React.RefObject<HTMLDivElement | null>;
	/** Further figures after the summary's, such as the settled days (#1896). */
	children?: React.ReactNode;
	displayedTotals: PayrollWorkspaceSummary["totals"];
	readyEmployeeCount: number;
	t: PayrollTranslate;
}) {
	return (
		<section
			aria-label={t("payroll.summary.title", "Payroll readiness summary")}
			className={[
				"grid grid-cols-2 divide-x divide-y rounded-lg border bg-card",
				children ? "sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0" : "sm:grid-cols-4 sm:divide-y-0",
			].join(" ")}
		>
			<StatusFigure
				icon={<IconUsers aria-hidden="true" className="size-4" />}
				label={t("payroll.summary.employees", "Employees")}
				value={displayedTotals.employeeCount.toString()}
			/>
			<StatusFigure
				label={t("payroll.summary.workedHours", "Worked hours")}
				value={formatHours(displayedTotals.totalWorkedHours)}
			/>
			<StatusFigure
				label={t("payroll.summary.ready", "Ready")}
				value={readyEmployeeCount.toString()}
			/>
			<StatusFigure
				focusRef={blockersSummaryRef}
				label={t("payroll.summary.blockers", "Blockers")}
				value={displayedTotals.blockerCount.toString()}
				tone={displayedTotals.blockerCount > 0 ? "warning" : "default"}
			/>
			{children}
		</section>
	);
}

export function StatusFigure({
	focusRef,
	icon,
	label,
	value,
	tone = "default",
}: {
	focusRef?: React.Ref<HTMLDivElement>;
	icon?: React.ReactNode;
	label: string;
	value: string;
	tone?: "default" | "warning";
}) {
	return (
		<div
			role="group"
			aria-label={label}
			className={[
				"min-w-0 space-y-1 px-4 py-3",
				tone === "warning"
					? "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20"
					: undefined,
				focusRef
					? "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					: undefined,
			]
				.filter(Boolean)
				.join(" ")}
			ref={focusRef}
			tabIndex={focusRef ? -1 : undefined}
		>
			<div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
				<span>{label}</span>
				{icon}
			</div>
			<div className="font-semibold text-xl tabular-nums tracking-tight">{value}</div>
		</div>
	);
}
