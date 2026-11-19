import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { Temporal } from "temporal-polyfill";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import {
	defaultPayrollReadinessMonth,
	formatPayrollReadinessMonth,
	formatPayrollReadinessPeriod,
	type PayrollReadinessPeriod,
	payrollReadinessAnchorMonth,
	payrollReadinessMonthHref,
} from "./payroll-readiness-period";

type TranslateFn = (
	key: string,
	defaultValue?: string,
	params?: Record<string, string | number>,
) => string;

/**
 * Steps the payroll-readiness period a whole UTC month at a time through the
 * page's `?start=&end=` parameters; the server reads the new period on navigation.
 */
export function PayrollReadinessPeriodNav({
	t,
	locale,
	period,
	today,
}: {
	t: TranslateFn;
	locale: string;
	period: PayrollReadinessPeriod;
	/** Today's UTC date: the current-month and previous-month shortcuts follow it. */
	today: Temporal.PlainDate;
}) {
	const anchor = payrollReadinessAnchorMonth(period);
	const previous = anchor.subtract({ months: 1 });
	const next = anchor.add({ months: 1 });
	const currentMonth = today.toPlainYearMonth();
	const previousMonth = defaultPayrollReadinessMonth(today);
	const showMonth = (month: Temporal.PlainYearMonth) =>
		t("settings.payrollReadiness.period.showMonth", "Show {month}", {
			month: formatPayrollReadinessMonth(month, locale),
		});

	return (
		<nav
			aria-label={t("settings.payrollReadiness.period.navLabel", "Payroll period")}
			className="flex flex-wrap items-center gap-2"
		>
			<div className="flex items-center gap-1">
				<Link
					aria-label={showMonth(previous)}
					className={buttonVariants({ variant: "outline", size: "icon" })}
					href={payrollReadinessMonthHref(previous)}
				>
					<IconChevronLeft aria-hidden="true" />
				</Link>
				<span
					className="min-w-36 px-2 text-center font-medium text-sm tabular-nums"
					data-testid="payroll-readiness-period-label"
				>
					{formatPayrollReadinessPeriod(period, locale)}
				</span>
				<Link
					aria-label={showMonth(next)}
					className={buttonVariants({ variant: "outline", size: "icon" })}
					href={payrollReadinessMonthHref(next)}
				>
					<IconChevronRight aria-hidden="true" />
				</Link>
			</div>
			<div className="flex items-center gap-1">
				<PeriodShortcut
					active={period.month?.equals(previousMonth) ?? false}
					href={payrollReadinessMonthHref(previousMonth)}
					label={t("settings.payrollReadiness.period.previousMonth", "Previous month")}
				/>
				<PeriodShortcut
					active={period.month?.equals(currentMonth) ?? false}
					href={payrollReadinessMonthHref(currentMonth)}
					label={t("settings.payrollReadiness.period.currentMonth", "Current month")}
				/>
			</div>
		</nav>
	);
}

function PeriodShortcut({
	active,
	href,
	label,
}: {
	active: boolean;
	href: string;
	label: string;
}) {
	return (
		<Link
			aria-current={active ? "page" : undefined}
			className={cn(buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }))}
			href={href}
		>
			{label}
		</Link>
	);
}
