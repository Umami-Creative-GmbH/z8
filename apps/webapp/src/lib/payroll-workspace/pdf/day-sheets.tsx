import { Temporal } from "temporal-polyfill";
import type {
	PayrollPeriodDay,
	PayrollPeriodDayAbsence,
	PayrollPeriodEmployee,
} from "@/lib/payroll-period/types";
import type { PayrollPdfContext, PayrollPdfSection } from "./context";
import { PDF_COLORS } from "./page-styles";
import { payrollPdfPage } from "./page-frame";

const HEADER_HEIGHT = 78;

const columns = {
	date: { width: "17%" },
	worked: { width: "10%", textAlign: "right" as const },
	required: { width: "10%", textAlign: "right" as const },
	difference: { width: "11%", textAlign: "right" as const },
	absence: { width: "19%", paddingLeft: 8 },
	holiday: { width: "11%" },
	settlement: { width: "22%" },
} as const;

const styles = {
	kicker: {
		fontSize: 7,
		fontWeight: "bold" as const,
		color: PDF_COLORS.accent,
	},
	title: { fontSize: 13, fontWeight: "bold" as const, color: PDF_COLORS.ink, marginTop: 2 },
	meta: { fontSize: 8, color: PDF_COLORS.muted, marginTop: 2, marginBottom: 6 },
	leftOn: { color: PDF_COLORS.changed },
	columnHeader: {
		flexDirection: "row" as const,
		paddingVertical: 4,
		paddingHorizontal: 4,
		backgroundColor: PDF_COLORS.headerFill,
		color: "#FFFFFF",
		fontSize: 7,
		fontWeight: "bold" as const,
		textTransform: "uppercase" as const,
	},
	row: {
		flexDirection: "row" as const,
		paddingVertical: 3,
		paddingHorizontal: 4,
		borderBottomWidth: 1,
		borderBottomColor: PDF_COLORS.faintRule,
		fontSize: 8,
	},
	weekend: { backgroundColor: PDF_COLORS.weekendFill },
	afterDeparture: { color: PDF_COLORS.muted },
	totalRow: {
		flexDirection: "row" as const,
		paddingVertical: 4,
		paddingHorizontal: 4,
		borderTopWidth: 1.5,
		borderTopColor: PDF_COLORS.ink,
		fontSize: 8,
		fontWeight: "bold" as const,
		color: PDF_COLORS.ink,
	},
	weekday: { color: PDF_COLORS.muted },
	settled: { color: PDF_COLORS.settled },
	changed: { color: PDF_COLORS.changed, fontWeight: "bold" as const },
	changeDetails: { color: PDF_COLORS.changed, fontSize: 7 },
	pending: { color: PDF_COLORS.muted },
} as const;

/**
 * One day sheet per employee in scope (#1900): a row per employee-local day of the
 * period with worked, required and difference hours, absences, holiday and the
 * settlement marker, ending in a total row. All figures come from the period read,
 * so a sheet matches the Days tab and its total matches the summary page.
 */
export const daySheetsSection: PayrollPdfSection = (context) =>
	context.read.employees.map((employee) => daySheet(context, employee));

function daySheet(context: PayrollPdfContext, employee: PayrollPeriodEmployee) {
	const { Text, View } = context.kit;
	const { read, t, format } = context;
	const meta = [
		employee.employeeNumber ?? t("payroll.pdf.noEmployeeNumber", "No employee no."),
		employee.teamName ?? t("payroll.pdf.noTeam", "No team"),
		t("payroll.pdf.daySheet.timezone", "Days in {timezone}", { timezone: employee.timezone }),
		`${read.period.label} (${format.date(read.period.start)} – ${format.date(read.period.end)})`,
	].join(" · ");

	return payrollPdfPage(context, {
		key: `day-sheet-${employee.id}`,
		headerHeight: HEADER_HEIGHT,
		header: (
			<>
				<Text style={styles.kicker}>{read.summary.organizationName}</Text>
				<Text style={styles.title}>
					{t("payroll.pdf.daySheet.title", "Day sheet {name}", { name: employee.name })}
				</Text>
				<Text style={styles.meta}>
					{meta}
					{employee.departure ? (
						<Text style={styles.leftOn}>
							{` · ${t("payroll.pdf.daySheet.leftOn", "Left on {date}", {
								date: format.date(employee.departure.lastWorkingDay),
							})}`}
						</Text>
					) : null}
				</Text>
				<View style={styles.columnHeader}>
					<Text style={columns.date}>{t("payroll.pdf.daySheet.date", "Date")}</Text>
					<Text style={columns.worked}>{t("payroll.pdf.daySheet.worked", "Worked")}</Text>
					<Text style={columns.required}>{t("payroll.pdf.daySheet.required", "Required")}</Text>
					<Text style={columns.difference}>
						{t("payroll.pdf.daySheet.difference", "Difference")}
					</Text>
					<Text style={columns.absence}>{t("payroll.pdf.daySheet.absence", "Absence")}</Text>
					<Text style={columns.holiday}>{t("payroll.pdf.daySheet.holiday", "Holiday")}</Text>
					<Text style={columns.settlement}>
						{t("payroll.pdf.daySheet.settlement", "Settlement")}
					</Text>
				</View>
			</>
		),
		children: (
			<>
				{employee.days.map((day) => daySheetRow(context, employee, day))}
				{totalRow(context, employee)}
			</>
		),
	});
}

function daySheetRow(
	context: PayrollPdfContext,
	employee: PayrollPeriodEmployee,
	day: PayrollPeriodDay,
) {
	const { Text, View } = context.kit;
	const { format } = context;
	const afterDeparture = employee.departure ? day.date > employee.departure.lastWorkingDay : false;
	return (
		<View
			key={day.date}
			wrap={false}
			style={[
				styles.row,
				...(isWeekend(day.date) ? [styles.weekend] : []),
				...(afterDeparture ? [styles.afterDeparture] : []),
			]}
		>
			<Text style={columns.date}>
				<Text style={styles.weekday}>{`${format.weekday(day.date)} `}</Text>
				{format.date(day.date)}
			</Text>
			<Text style={columns.worked}>{format.hours(day.creditedMinutes)}</Text>
			<Text style={columns.required}>
				{day.requiredMinutes === null ? "–" : format.hours(day.requiredMinutes)}
			</Text>
			<Text style={columns.difference}>
				{day.differenceMinutes === null ? "–" : format.difference(day.differenceMinutes)}
			</Text>
			<Text style={columns.absence}>
				{day.absences.map((absence, index) => (
					<Text
						key={absence.absenceId}
						style={absence.approvalState === "pending" ? styles.pending : undefined}
					>
						{`${index > 0 ? "; " : ""}${absenceText(context, absence)}`}
					</Text>
				))}
			</Text>
			<Text style={columns.holiday}>{day.holiday?.name ?? ""}</Text>
			{settlementMarker(context, day)}
		</View>
	);
}

/** "Vacation (AM)", "Sick (pending)": the category, its day half and a pending flag. */
function absenceText(context: PayrollPdfContext, absence: PayrollPeriodDayAbsence): string {
	const { t } = context;
	const details = [
		absencePeriodText(context, absence.period),
		absence.approvalState === "pending" ? t("payroll.pdf.absence.pending", "pending") : null,
	].filter(Boolean);
	return details.length > 0
		? `${absence.categoryName} (${details.join(", ")})`
		: absence.categoryName;
}

export function absencePeriodText(
	context: Pick<PayrollPdfContext, "t">,
	period: PayrollPeriodDayAbsence["period"],
): string | null {
	const { t } = context;
	switch (period) {
		case "am":
			return t("payroll.pdf.absence.am", "AM");
		case "pm":
			return t("payroll.pdf.absence.pm", "PM");
		case "partial_day":
			return t("payroll.pdf.absence.partialDay", "Partial day");
		default:
			return null;
	}
}

/**
 * A settled day reads "Settled"; a day changed since settled has its own marker
 * with what changed, such as "Changed since settled: +1.5 h, absence changed".
 */
function settlementMarker(context: PayrollPdfContext, day: PayrollPeriodDay) {
	const { Text, View } = context.kit;
	const { t, format } = context;
	if (day.settlement?.state === "settled") {
		return (
			<Text style={[columns.settlement, styles.settled]}>
				{t("payroll.pdf.daySheet.settled", "Settled")}
			</Text>
		);
	}
	if (day.settlement?.state === "changed_since_settled") {
		const { creditedMinutesDifference, absencesChanged } = day.settlement.change;
		const details = [
			creditedMinutesDifference !== 0 ? format.change(creditedMinutesDifference) : null,
			absencesChanged ? t("payroll.pdf.daySheet.absenceChanged", "absence changed") : null,
		]
			.filter(Boolean)
			.join(", ");
		return (
			<View style={columns.settlement}>
				<Text style={styles.changed}>
					{t("payroll.pdf.daySheet.changedSinceSettled", "Changed since settled")}
				</Text>
				<Text style={styles.changeDetails}>{details}</Text>
			</View>
		);
	}
	return <Text style={columns.settlement} />;
}

function totalRow(context: PayrollPdfContext, employee: PayrollPeriodEmployee) {
	const { Text, View } = context.kit;
	const { t, format } = context;
	const { totals } = employee;
	const settledDays = employee.days.filter(
		(day) => day.settlement !== undefined && day.settlement.state !== "unsettled",
	).length;
	return (
		<View key="total" wrap={false} style={styles.totalRow}>
			<Text style={columns.date}>{t("payroll.pdf.daySheet.total", "Total")}</Text>
			<Text style={columns.worked}>{format.hours(totals.creditedMinutes)}</Text>
			<Text style={columns.required}>
				{totals.requiredMinutes === null ? "–" : format.hours(totals.requiredMinutes)}
			</Text>
			<Text style={columns.difference}>
				{totals.differenceMinutes === null ? "–" : format.difference(totals.differenceMinutes)}
			</Text>
			<Text style={columns.absence}>
				{totals.absenceDays > 0
					? t("payroll.pdf.daySheet.absenceDays", "{days} absence days", {
							days: format.days(totals.absenceDays),
						})
					: ""}
			</Text>
			<Text style={columns.holiday} />
			<Text style={columns.settlement}>
				{settledDays > 0
					? t("payroll.pdf.daySheet.settledDays", "{count} settled", { count: settledDays })
					: ""}
			</Text>
		</View>
	);
}

function isWeekend(date: string): boolean {
	return Temporal.PlainDate.from(date).dayOfWeek >= 6;
}
