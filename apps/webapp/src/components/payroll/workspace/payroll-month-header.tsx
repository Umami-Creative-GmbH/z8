"use client";

import { cn } from "@/lib/utils";
import type { PayrollDaysFormat } from "./payroll-day-format";
import { payrollMonthSegments } from "./payroll-month-segments";

/** The stronger left border of a month's first day column, in the header and the body. */
export const PAYROLL_MONTH_START_CLASS = "border-l-2 border-l-foreground/30";

/**
 * The month row above a payroll grid's day header: one cell per month spanning its day
 * columns. Each month's label sticks just right of the sticky employee column while the
 * grid scrolls right, until its month's last column scrolls past.
 */
export function PayrollMonthHeaderRow({
	ariaRowIndex,
	className,
	dates,
	employeeColumn,
	format,
	gridTemplateColumns,
	trailingColumns = 0,
}: {
	ariaRowIndex: number;
	className?: string;
	dates: readonly string[];
	/** The sticky employee column's width, where the labels stick. */
	employeeColumn: string;
	format: Pick<PayrollDaysFormat, "monthYear">;
	gridTemplateColumns: string;
	/** Columns after the days, such as the Days grid's total. */
	trailingColumns?: number;
}) {
	return (
		<tr
			aria-rowindex={ariaRowIndex}
			className={cn("grid border-b bg-muted text-xs", className)}
			style={{ gridTemplateColumns }}
		>
			<td aria-hidden="true" className="sticky left-0 z-10 border-r bg-muted" />
			{payrollMonthSegments(dates).map((segment, index) => {
				const label = format.monthYear(segment.firstDate);
				return (
					<th
						key={segment.month}
						scope="colgroup"
						colSpan={segment.length}
						title={label}
						data-payroll-month={segment.month}
						className={cn("min-w-0 py-1 text-left", index > 0 && PAYROLL_MONTH_START_CLASS)}
						style={{ gridColumn: `span ${segment.length}` }}
					>
						<span
							className="sticky inline-block max-w-full truncate px-2 align-top font-semibold text-foreground"
							style={{ left: employeeColumn }}
						>
							{label}
						</span>
					</th>
				);
			})}
			{trailingColumns > 0 ? (
				<td
					aria-hidden="true"
					className="border-l"
					style={{ gridColumn: `span ${trailingColumns}` }}
				/>
			) : null}
		</tr>
	);
}
