import type { PayrollAbsenceDetailPeriod, PayrollWorkspaceSummary } from "../types";
import type { PayrollPdfSection, PayrollPdfTranslate } from "./context";
import { PDF_COLORS, payrollPdfPage } from "./page-frame";

export interface PayrollAbsenceSection {
	employeeId: string;
	employeeName: string;
	employeeNumber: string | null;
	rows: Array<{
		date: string;
		categoryName: string;
		periodLabel: string;
	}>;
}

export interface PayrollAbsenceReportRow {
	employeeName: string;
	employeeNumber: string;
	date: string;
	categoryName: string;
	periodLabel: string;
}

/** The static English defaults, for callers without a translation. */
const englishDefaults: PayrollPdfTranslate = (_key, defaultValue) => defaultValue;

const styles = {
	title: { fontSize: 11, fontWeight: "bold" as const, color: PDF_COLORS.ink, marginBottom: 5 },
	columnHeader: {
		flexDirection: "row" as const,
		paddingVertical: 4,
		paddingHorizontal: 7,
		borderBottomWidth: 1,
		borderBottomColor: PDF_COLORS.rule,
		fontSize: 7,
		fontWeight: "bold" as const,
		textTransform: "uppercase" as const,
		color: PDF_COLORS.muted,
	},
	row: {
		flexDirection: "row" as const,
		paddingVertical: 4,
		paddingHorizontal: 7,
		borderTopWidth: 1,
		borderTopColor: PDF_COLORS.faintRule,
	},
	date: { width: "18%" },
	employee: { width: "28%" },
	category: { width: "39%" },
	period: { width: "15%", textAlign: "right" as const },
	employeeName: { fontWeight: "bold" as const, color: PDF_COLORS.ink },
	muted: { color: PDF_COLORS.muted },
} as const;

/**
 * The approved absences of the period, one row per employee-day.
 * Replaced by the absence calendar and list (#1901).
 */
export const absenceDetailsSection: PayrollPdfSection = (context) => {
	const rows = flattenPayrollAbsenceSections(
		buildPayrollAbsenceSections(context.read.summary, context.t),
		context.t,
	);
	if (rows.length === 0) return [];
	const { Text, View } = context.kit;
	const { t, format } = context;

	return [
		payrollPdfPage(context, {
			key: "absence-details",
			headerHeight: 46,
			header: (
				<>
					<Text style={styles.title}>
						{t("payroll.pdf.absenceDetails.title", "Absence details")}
					</Text>
					<View style={styles.columnHeader}>
						<Text style={styles.employee}>
							{t("payroll.pdf.absenceDetails.employee", "Employee")}
						</Text>
						<Text style={styles.date}>{t("payroll.pdf.absenceDetails.date", "Date")}</Text>
						<Text style={styles.category}>
							{t("payroll.pdf.absenceDetails.category", "Category")}
						</Text>
						<Text style={styles.period}>{t("payroll.pdf.absenceDetails.period", "Period")}</Text>
					</View>
				</>
			),
			children: rows.map((row, rowIndex) => (
				<View
					// oxlint-disable-next-line react/no-array-index-key -- Sorted PDF rows are immutable and duplicate details must remain distinct.
					key={`${row.employeeName}-${row.date}-${row.categoryName}-${row.periodLabel}-${rowIndex}`}
					style={styles.row}
					wrap={false}
				>
					<View style={styles.employee}>
						<Text style={styles.employeeName}>{row.employeeName}</Text>
						<Text style={styles.muted}>{row.employeeNumber}</Text>
					</View>
					<Text style={styles.date}>{format.date(row.date)}</Text>
					<Text style={styles.category}>{row.categoryName}</Text>
					<Text style={styles.period}>{row.periodLabel}</Text>
				</View>
			)),
		}),
	];
};

function compareText(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function formatAbsencePeriod(period: PayrollAbsenceDetailPeriod, t: PayrollPdfTranslate): string {
	switch (period) {
		case "full_day":
			return t("payroll.pdf.absence.fullDay", "Full day");
		case "partial_day":
			return t("payroll.pdf.absence.partialDay", "Partial day");
		case "am":
			return t("payroll.pdf.absence.am", "AM");
		case "pm":
			return t("payroll.pdf.absence.pm", "PM");
	}
}

export function buildPayrollAbsenceSections(
	summary: PayrollWorkspaceSummary,
	t: PayrollPdfTranslate = englishDefaults,
): PayrollAbsenceSection[] {
	const detailsByEmployee = new Map<string, PayrollWorkspaceSummary["absenceDetails"]>();

	for (const detail of summary.absenceDetails) {
		const details = detailsByEmployee.get(detail.employeeId) ?? [];
		details.push(detail);
		detailsByEmployee.set(detail.employeeId, details);
	}

	// Rows sort by the English period names, so the order is the same in every language.
	return summary.employees
		.filter((employee) => detailsByEmployee.has(employee.id))
		.sort((left, right) => left.name.localeCompare(right.name) || compareText(left.id, right.id))
		.map((employee) => ({
			employeeId: employee.id,
			employeeName: employee.name,
			employeeNumber: employee.employeeNumber,
			rows: [...(detailsByEmployee.get(employee.id) ?? [])]
				.sort(
					(left, right) =>
						compareText(left.date, right.date) ||
						compareText(left.categoryName, right.categoryName) ||
						compareText(
							formatAbsencePeriod(left.period, englishDefaults),
							formatAbsencePeriod(right.period, englishDefaults),
						) ||
						compareText(left.categoryId, right.categoryId),
				)
				.map((detail) => ({
					date: detail.date,
					categoryName: detail.categoryName,
					periodLabel: formatAbsencePeriod(detail.period, t),
				})),
		}));
}

export function flattenPayrollAbsenceSections(
	sections: PayrollAbsenceSection[],
	t: PayrollPdfTranslate = englishDefaults,
): PayrollAbsenceReportRow[] {
	return sections.flatMap((section) =>
		section.rows.map((row) => ({
			employeeName: section.employeeName,
			employeeNumber:
				section.employeeNumber ?? t("payroll.pdf.noEmployeeNumber", "No employee no."),
			...row,
		})),
	);
}
