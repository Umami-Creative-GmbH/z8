import { Temporal } from "temporal-polyfill";
import type { PayrollPeriodDayAbsence, PayrollPeriodEmployee } from "@/lib/payroll-period/types";
import { type PayrollPdfAbsenceCategory, payrollPdfAbsenceCategories } from "./absence-codes";
import type { PayrollPdfContext, PayrollPdfSection } from "./context";
import { PDF_COLORS, payrollPdfPage } from "./page-frame";

/** Content width of a landscape A4 page (842 pt) inside the page frame's side margins. */
const CONTENT_WIDTH = 770;
const EMPLOYEE_COLUMN = 118;
const MAX_DAY_COLUMN = 40;
/** A page holds at most this many days; a longer period splits by calendar month. */
const MAX_DAYS_PER_PAGE = 31;
const HEADER_HEIGHT = 62;
const ROW_HEIGHT = 15;
/** react-pdf truncates text with these props, which its typings leave out. */
const SINGLE_LINE: object = { maxLines: 1, textOverflow: "ellipsis" };

const styles = {
	title: { fontSize: 13, fontWeight: "bold" as const, color: PDF_COLORS.ink },
	meta: { fontSize: 8, color: PDF_COLORS.muted, marginTop: 2, marginBottom: 6 },
	dateHeader: {
		flexDirection: "row" as const,
		backgroundColor: PDF_COLORS.headerFill,
		color: "#FFFFFF",
		fontSize: 6,
	},
	employeeHeader: {
		width: EMPLOYEE_COLUMN,
		paddingHorizontal: 4,
		paddingVertical: 3,
		fontWeight: "bold" as const,
		fontSize: 7,
		textTransform: "uppercase" as const,
	},
	dateHead: { alignItems: "center" as const, paddingVertical: 2 },
	dateHeadWeekend: { backgroundColor: "#3B4F9E" },
	dayOfMonth: { fontSize: 7, fontWeight: "bold" as const },
	row: {
		flexDirection: "row" as const,
		height: ROW_HEIGHT,
		borderBottomWidth: 0.5,
		borderBottomColor: PDF_COLORS.faintRule,
	},
	employeeName: {
		width: EMPLOYEE_COLUMN,
		paddingHorizontal: 4,
		paddingTop: 4,
		fontSize: 7,
		lineHeight: 1,
		color: PDF_COLORS.ink,
	},
	cell: {
		flexDirection: "row" as const,
		padding: 1,
		borderLeftWidth: 0.5,
		borderLeftColor: PDF_COLORS.faintRule,
	},
	weekend: { backgroundColor: PDF_COLORS.weekendFill },
	mark: {
		flexGrow: 1,
		flexBasis: 0,
		alignItems: "center" as const,
		justifyContent: "center" as const,
		borderRadius: 1,
	},
	// The page's line height is absolute; text in a fixed-height box needs its own, or
	// react-pdf drops it when the line does not fit.
	markText: { fontSize: 5.5, lineHeight: 1, fontWeight: "bold" as const },
	halfText: { fontSize: 4.5, lineHeight: 1, fontWeight: "bold" as const },
	legend: { marginTop: 10, fontSize: 7, color: PDF_COLORS.text },
	legendTitle: { fontSize: 8, fontWeight: "bold" as const, color: PDF_COLORS.ink, marginBottom: 4 },
	legendRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, marginBottom: 3 },
	legendItem: {
		flexDirection: "row" as const,
		alignItems: "center" as const,
		marginRight: 12,
		marginBottom: 2,
	},
	legendSwatch: {
		width: 18,
		height: 11,
		flexDirection: "row" as const,
		marginRight: 4,
		borderRadius: 1,
	},
} as const;

/**
 * The period's absences as a landscape calendar (#1901): the employees in scope against
 * the employee-local days of the period. Each cell shows the category code, as a whole
 * day or as a morning (left) and afternoon (right) half; pending absences are outlined
 * and starred. Employees flow onto further pages under the repeated date header; a
 * period longer than a month gets one calendar per calendar month. A legend explains
 * the codes. Left out when the period has no absences.
 */
export const absenceCalendarSection: PayrollPdfSection = (context) => {
	const { read } = context;
	if (read.absences.length === 0) return [];
	const categories = new Map(
		payrollPdfAbsenceCategories(read.absences).map((category) => [category.categoryId, category]),
	);

	return dateChunks(read.period.start, read.period.end).map((dates) =>
		calendarPage(context, dates, categories),
	);
};

function calendarPage(
	context: PayrollPdfContext,
	dates: readonly string[],
	categories: ReadonlyMap<string, PayrollPdfAbsenceCategory>,
) {
	const { Text, View } = context.kit;
	const { read, t, format } = context;
	const dayWidth = Math.min(MAX_DAY_COLUMN, (CONTENT_WIDTH - EMPLOYEE_COLUMN) / dates.length);
	const first = dates[0] ?? read.period.start;
	const last = dates.at(-1) ?? read.period.end;

	return payrollPdfPage(context, {
		key: `absence-calendar-${first}`,
		orientation: "landscape",
		headerHeight: HEADER_HEIGHT,
		header: (
			<>
				<Text style={styles.title}>
					{t("payroll.pdf.absenceCalendar.title", "Absence calendar")}
				</Text>
				<Text style={styles.meta}>
					{[
						read.summary.organizationName,
						`${read.period.label} (${format.date(first)} – ${format.date(last)})`,
						t("payroll.pdf.absenceCalendar.localDays", "Days in each employee's timezone"),
					].join(" · ")}
				</Text>
				<View style={styles.dateHeader}>
					<Text style={styles.employeeHeader}>
						{t("payroll.pdf.absenceCalendar.employee", "Employee")}
					</Text>
					{dates.map((date) => (
						<View
							key={date}
							style={[
								styles.dateHead,
								{ width: dayWidth },
								...(isWeekend(date) ? [styles.dateHeadWeekend] : []),
							]}
						>
							<Text>{format.weekday(date)}</Text>
							<Text style={styles.dayOfMonth}>{String(Temporal.PlainDate.from(date).day)}</Text>
						</View>
					))}
				</View>
			</>
		),
		children: (
			<>
				{read.employees.map((employee) =>
					employeeRow(context, employee, dates, dayWidth, categories),
				)}
				{legend(context, [...categories.values()])}
			</>
		),
	});
}

function employeeRow(
	context: PayrollPdfContext,
	employee: PayrollPeriodEmployee,
	dates: readonly string[],
	dayWidth: number,
	categories: ReadonlyMap<string, PayrollPdfAbsenceCategory>,
) {
	const { Text, View } = context.kit;
	const absencesByDate = new Map(employee.days.map((day) => [day.date, day.absences]));
	return (
		<View key={employee.id} wrap={false} style={styles.row}>
			<Text style={styles.employeeName} {...SINGLE_LINE}>
				{employee.name}
			</Text>
			{dates.map((date) => (
				<View
					key={date}
					style={[styles.cell, { width: dayWidth }, ...(isWeekend(date) ? [styles.weekend] : [])]}
				>
					{dayMarks(context, absencesByDate.get(date) ?? [], categories)}
				</View>
			))}
		</View>
	);
}

/**
 * A whole-day absence fills the cell; half days fill the morning (left) or afternoon
 * (right) half; a partial day is the code over a bar at the bottom of the cell.
 */
function dayMarks(
	context: PayrollPdfContext,
	absences: readonly PayrollPeriodDayAbsence[],
	categories: ReadonlyMap<string, PayrollPdfAbsenceCategory>,
) {
	if (absences.length === 0) return null;
	const { View } = context.kit;
	const fullDay = absences.find((absence) => absence.period === "full_day");
	const morning = absences.find((absence) => absence.period === "am");
	const afternoon = absences.find((absence) => absence.period === "pm");
	const partial = absences.find((absence) => absence.period === "partial_day");

	if (fullDay) return mark(context, fullDay, categories, "whole", "full");
	if (morning || afternoon) {
		return (
			<>
				{morning ? mark(context, morning, categories, "half", "am") : <View style={styles.mark} />}
				{afternoon ? (
					mark(context, afternoon, categories, "half", "pm")
				) : (
					<View style={styles.mark} />
				)}
			</>
		);
	}
	return partial ? mark(context, partial, categories, "whole", "partial") : null;
}

function mark(
	context: PayrollPdfContext,
	absence: PayrollPeriodDayAbsence,
	categories: ReadonlyMap<string, PayrollPdfAbsenceCategory>,
	size: "whole" | "half",
	key: string,
) {
	const { Text, View } = context.kit;
	const category = categories.get(absence.categoryId);
	const color = category?.color ?? PDF_COLORS.muted;
	const pending = absence.approvalState === "pending";
	const partial = absence.period === "partial_day";
	const outlined = pending || partial;
	return (
		<View
			key={key}
			style={[
				styles.mark,
				outlined
					? {
							backgroundColor: "#FFFFFF",
							borderWidth: pending ? 0.75 : 0,
							borderStyle: "dashed" as const,
							borderColor: color,
							...(partial ? { borderBottomWidth: 3, borderBottomStyle: "solid" as const } : {}),
						}
					: { backgroundColor: color },
			]}
		>
			<Text
				style={[
					size === "half" ? styles.halfText : styles.markText,
					{ color: outlined ? color : (category?.textColor ?? "#FFFFFF") },
				]}
			>
				{`${category?.code ?? "?"}${pending ? "*" : ""}`}
			</Text>
		</View>
	);
}

function legend(context: PayrollPdfContext, categories: readonly PayrollPdfAbsenceCategory[]) {
	const { Text, View } = context.kit;
	const { t } = context;
	const sample = { color: PDF_COLORS.muted };
	const swatchText = { ...styles.halfText, color: "#FFFFFF" };
	return (
		<View key="legend" wrap={false} style={styles.legend}>
			<Text style={styles.legendTitle}>{t("payroll.pdf.absenceCalendar.legend", "Legend")}</Text>
			<View style={styles.legendRow}>
				{categories.map((category) => (
					<View key={category.categoryId} style={styles.legendItem}>
						<View style={[styles.legendSwatch, { backgroundColor: category.color }]}>
							<View style={styles.mark}>
								<Text style={[styles.markText, { color: category.textColor }]}>
									{category.code}
								</Text>
							</View>
						</View>
						<Text>{category.categoryName}</Text>
					</View>
				))}
			</View>
			<View style={styles.legendRow}>
				<View style={styles.legendItem}>
					<View style={styles.legendSwatch}>
						<View style={[styles.mark, { backgroundColor: sample.color, marginRight: 1 }]}>
							<Text style={swatchText}>{t("payroll.pdf.absence.am", "AM")}</Text>
						</View>
						<View style={[styles.mark, { backgroundColor: sample.color }]}>
							<Text style={swatchText}>{t("payroll.pdf.absence.pm", "PM")}</Text>
						</View>
					</View>
					<Text>
						{t(
							"payroll.pdf.absenceCalendar.halves",
							"Left half morning (AM), right half afternoon (PM)",
						)}
					</Text>
				</View>
				<View style={styles.legendItem}>
					<View
						style={[
							styles.legendSwatch,
							{ borderWidth: 0.75, borderStyle: "dashed", borderColor: sample.color },
						]}
					>
						<View style={styles.mark}>
							<Text style={[styles.markText, sample]}>*</Text>
						</View>
					</View>
					<Text>{t("payroll.pdf.absenceCalendar.pending", "Pending, not approved yet")}</Text>
				</View>
				<View style={styles.legendItem}>
					<View
						style={[styles.legendSwatch, { borderBottomWidth: 3, borderColor: sample.color }]}
					/>
					<Text>{t("payroll.pdf.absenceCalendar.partialDay", "Part of the day")}</Text>
				</View>
			</View>
		</View>
	);
}

/** The period's dates, one page's worth each: the whole period, or one calendar month. */
function dateChunks(start: string, end: string): string[][] {
	const dates: string[] = [];
	const last = Temporal.PlainDate.from(end);
	for (
		let date = Temporal.PlainDate.from(start);
		Temporal.PlainDate.compare(date, last) <= 0;
		date = date.add({ days: 1 })
	) {
		dates.push(date.toString());
	}
	if (dates.length <= MAX_DAYS_PER_PAGE) return [dates];
	const months = new Map<string, string[]>();
	for (const date of dates) {
		const month = date.slice(0, 7);
		months.set(month, [...(months.get(month) ?? []), date]);
	}
	return [...months.values()];
}

function isWeekend(date: string): boolean {
	return Temporal.PlainDate.from(date).dayOfWeek >= 6;
}
