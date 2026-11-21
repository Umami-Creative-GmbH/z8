import type { PayrollPeriodAbsence } from "@/lib/payroll-period/types";
import type { PayrollDayPeriod } from "../types";
import { type PayrollPdfAbsenceCategory, payrollPdfAbsenceCategories } from "./absence-codes";
import type { PayrollPdfContext, PayrollPdfSection } from "./context";
import { PDF_COLORS } from "./page-styles";
import { payrollPdfPage } from "./page-frame";

const HEADER_HEIGHT = 62;

const columns = {
	employee: { width: "22%", paddingRight: 6 },
	category: { width: "26%", paddingRight: 6 },
	dates: { width: "25%", paddingRight: 6 },
	days: { width: "14%", textAlign: "right" as const, paddingRight: 10 },
	status: { width: "13%" },
} as const;

const styles = {
	title: { fontSize: 13, fontWeight: "bold" as const, color: PDF_COLORS.ink },
	meta: { fontSize: 8, color: PDF_COLORS.muted, marginTop: 2, marginBottom: 6 },
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
	pendingNote: {
		fontSize: 8,
		fontWeight: "bold" as const,
		color: PDF_COLORS.changed,
		marginBottom: 4,
	},
	row: {
		flexDirection: "row" as const,
		paddingVertical: 4,
		paddingHorizontal: 4,
		borderBottomWidth: 1,
		borderBottomColor: PDF_COLORS.faintRule,
		fontSize: 8,
	},
	pendingRow: { backgroundColor: "#FFFBEB" },
	employeeName: { fontWeight: "bold" as const, color: PDF_COLORS.ink },
	category: { flexDirection: "row" as const, alignItems: "center" as const },
	code: {
		width: 16,
		height: 10,
		marginRight: 5,
		borderRadius: 1,
		alignItems: "center" as const,
		justifyContent: "center" as const,
	},
	// Text in a fixed-height box needs its own line height (see the absence calendar).
	codeText: { fontSize: 5.5, lineHeight: 1, fontWeight: "bold" as const },
	pending: { color: PDF_COLORS.changed, fontWeight: "bold" as const },
	approved: { color: PDF_COLORS.muted },
} as const;

/**
 * The period's absence list (#1901), as the Absences tab lists it: one row per absence
 * with employee, category, from–to with half days or times, the days it counts inside
 * the period, and whether it is approved or still pending. Left out when the period
 * has no absences.
 */
export const absenceListSection: PayrollPdfSection = (context) => {
	const { read, t, format } = context;
	if (read.absences.length === 0) return [];
	const { Text, View } = context.kit;
	const categories = new Map(
		payrollPdfAbsenceCategories(read.absences).map((category) => [category.categoryId, category]),
	);
	const names = new Map(read.employees.map((employee) => [employee.id, employee.name]));
	const nameOf = (employeeId: string) => names.get(employeeId) ?? employeeId;
	const rows = read.absences.toSorted(
		(left, right) =>
			nameOf(left.employeeId).localeCompare(nameOf(right.employeeId)) ||
			left.startDate.localeCompare(right.startDate) ||
			left.id.localeCompare(right.id),
	);
	const pendingCount = rows.filter((absence) => absence.approvalState === "pending").length;

	return [
		payrollPdfPage(context, {
			key: "absence-list",
			headerHeight: HEADER_HEIGHT,
			header: (
				<>
					<Text style={styles.title}>{t("payroll.pdf.absenceList.title", "Absence list")}</Text>
					<Text style={styles.meta}>
						{[
							read.summary.organizationName,
							`${read.period.label} (${format.date(read.period.start)} – ${format.date(read.period.end)})`,
							t("payroll.pdf.absenceCalendar.localDays", "Days in each employee's timezone"),
						].join(" · ")}
					</Text>
					<View style={styles.columnHeader}>
						<Text style={columns.employee}>
							{t("payroll.pdf.absenceList.employee", "Employee")}
						</Text>
						<Text style={columns.category}>
							{t("payroll.pdf.absenceList.category", "Category")}
						</Text>
						<Text style={columns.dates}>{t("payroll.pdf.absenceList.dates", "From – to")}</Text>
						<Text style={columns.days}>{t("payroll.pdf.absenceList.days", "Days counted")}</Text>
						<Text style={columns.status}>{t("payroll.pdf.absenceList.status", "Status")}</Text>
					</View>
				</>
			),
			children: (
				<>
					{pendingCount > 0 ? (
						<Text style={styles.pendingNote}>
							{pendingCount === 1
								? t("payroll.pdf.absenceList.pendingOne", "1 pending absence blocks payroll")
								: t(
										"payroll.pdf.absenceList.pendingOther",
										"{count} pending absences block payroll",
										{ count: pendingCount },
									)}
						</Text>
					) : null}
					{rows.map((absence) =>
						absenceRow(context, absence, nameOf(absence.employeeId), categories),
					)}
				</>
			),
		}),
	];
};

function absenceRow(
	context: PayrollPdfContext,
	absence: PayrollPeriodAbsence,
	employeeName: string,
	categories: ReadonlyMap<string, PayrollPdfAbsenceCategory>,
) {
	const { Text, View } = context.kit;
	const { t, format } = context;
	const pending = absence.approvalState === "pending";
	const category = categories.get(absence.categoryId);
	const color = category?.color ?? PDF_COLORS.muted;
	return (
		<View
			key={absence.id}
			wrap={false}
			style={[styles.row, ...(pending ? [styles.pendingRow] : [])]}
		>
			<Text style={[columns.employee, styles.employeeName]}>{employeeName}</Text>
			<View style={[columns.category, styles.category]}>
				<View
					style={[
						styles.code,
						pending
							? { borderWidth: 0.75, borderStyle: "dashed", borderColor: color }
							: { backgroundColor: color },
					]}
				>
					<Text
						style={[
							styles.codeText,
							{ color: pending ? color : (category?.textColor ?? "#FFFFFF") },
						]}
					>
						{category?.code ?? "?"}
					</Text>
				</View>
				<Text>{absence.categoryName}</Text>
			</View>
			<Text style={columns.dates}>{absenceRangeText(context, absence)}</Text>
			<Text style={columns.days}>{format.days(absence.daysInPeriod)}</Text>
			<Text style={[columns.status, pending ? styles.pending : styles.approved]}>
				{pending
					? t("payroll.pdf.absenceList.pending", "Pending")
					: t("payroll.pdf.absenceList.approved", "Approved")}
			</Text>
		</View>
	);
}

/** From–to as the Absences tab shows it: with the half of a half day, or the times. */
function absenceRangeText(context: PayrollPdfContext, absence: PayrollPeriodAbsence): string {
	const { format } = context;
	const start = format.date(absence.startDate);
	const end = format.date(absence.endDate);
	if (absence.startTime && absence.endTime) {
		const times = `${absence.startTime.slice(0, 5)}–${absence.endTime.slice(0, 5)}`;
		return absence.startDate === absence.endDate
			? `${start}, ${times}`
			: `${start} – ${end}, ${times}`;
	}
	if (absence.startDate === absence.endDate) {
		// One day: a single half is that half; anything else covers the whole day.
		return absence.startPeriod === absence.endPeriod
			? withHalf(context, start, absence.startPeriod)
			: start;
	}
	return `${withHalf(context, start, absence.startPeriod)} – ${withHalf(context, end, absence.endPeriod)}`;
}

function withHalf(context: PayrollPdfContext, date: string, period: PayrollDayPeriod): string {
	const { t } = context;
	if (period === "am") return `${date} (${t("payroll.pdf.absence.am", "AM")})`;
	if (period === "pm") return `${date} (${t("payroll.pdf.absence.pm", "PM")})`;
	return date;
}
