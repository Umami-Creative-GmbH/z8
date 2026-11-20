import type { ReactElement } from "react";
import type { PayrollPeriodRead } from "@/lib/payroll-period/types";
import type { PayrollLabelTranslate } from "../blocker-labels";
import type { PayrollPdfFormat } from "./format";

/** Tolgee's `t` in the language of the person exporting the PDF. */
export type PayrollPdfTranslate = PayrollLabelTranslate;

/** The `@react-pdf/renderer` primitives, imported on demand by the exporter. */
export type PayrollPdfKit = Pick<typeof import("@react-pdf/renderer"), "Page" | "Text" | "View">;

/** Everything a PDF section needs to render its pages. */
export interface PayrollPdfContext {
	/** The payroll period read (#1893): the only source of the PDF's figures. */
	read: PayrollPeriodRead;
	t: PayrollPdfTranslate;
	locale: string;
	format: PayrollPdfFormat;
	kit: PayrollPdfKit;
}

/**
 * One part of the payroll PDF: it returns its own `<Page>` elements (none when it has
 * nothing to show). The exporter renders the sections in order, so a new part of the
 * PDF is a new section in `PAYROLL_PDF_SECTIONS`.
 */
export type PayrollPdfSection = (context: PayrollPdfContext) => ReactElement[];
