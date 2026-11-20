import type { PayrollPeriodRead } from "@/lib/payroll-period/types";
import { absenceDetailsSection } from "./pdf/absence-details-page";
import type { PayrollPdfContext, PayrollPdfSection, PayrollPdfTranslate } from "./pdf/context";
import { daySheetsSection } from "./pdf/day-sheets";
import { payrollPdfFormat } from "./pdf/format";
import { summarySection } from "./pdf/summary-page";
import type { PayrollWorkspaceSummary } from "./types";

export {
	buildPayrollAbsenceSections,
	flattenPayrollAbsenceSections,
	type PayrollAbsenceReportRow,
	type PayrollAbsenceSection,
} from "./pdf/absence-details-page";
export type { PayrollPdfTranslate } from "./pdf/context";

/**
 * The parts of the payroll PDF, in order. Each section renders its own pages from the
 * same period read; add a part of the PDF by adding a section here.
 */
const PAYROLL_PDF_SECTIONS: readonly PayrollPdfSection[] = [
	summarySection,
	daySheetsSection,
	absenceDetailsSection,
];

/**
 * The payroll PDF of a period read (#1891): the summary page, then a day sheet per
 * employee, then the period's absences. Every figure comes from `read`, so the PDF
 * matches the workspace; every label goes through `t` in the exporter's language and
 * dates and numbers are formatted for `locale`.
 */
export async function exportPayrollPeriodToPDF(
	read: PayrollPeriodRead,
	options: { t: PayrollPdfTranslate; locale: string },
): Promise<Uint8Array> {
	const { Document, Page, pdf, Text, View } = await import("@react-pdf/renderer");
	const context: PayrollPdfContext = {
		read,
		t: options.t,
		locale: options.locale,
		format: payrollPdfFormat(options.locale),
		kit: { Page, Text, View },
	};
	const pages = PAYROLL_PDF_SECTIONS.flatMap((section) => section(context));

	const blob = await pdf(<Document>{pages}</Document>).toBlob();
	return new Uint8Array(await blob.arrayBuffer());
}

export function generatePayrollPDFFilename(summary: PayrollWorkspaceSummary): string {
	const organizationSlug =
		summary.organizationName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "organization";

	return `payroll-${organizationSlug}-${summary.period.start}-${summary.period.end}.pdf`;
}
