import type { ReactNode } from "react";
import type { PayrollPdfContext } from "./context";

export const PDF_COLORS = {
	ink: "#0F172A",
	text: "#1F2937",
	muted: "#64748B",
	rule: "#CBD5E1",
	faintRule: "#E2E8F0",
	accent: "#1D4ED8",
	headerFill: "#1E3A8A",
	weekendFill: "#F8FAFC",
	settled: "#047857",
	changed: "#B45309",
} as const;

const PAGE_TOP = 28;
const PAGE_SIDE = 36;

export const basePageStyle = {
	paddingTop: 34,
	paddingRight: PAGE_SIDE,
	paddingBottom: 48,
	paddingLeft: PAGE_SIDE,
	fontFamily: "Helvetica",
	fontSize: 9,
	lineHeight: 1.35,
	color: PDF_COLORS.text,
} as const;

const frameStyles = {
	header: {
		position: "absolute" as const,
		top: PAGE_TOP,
		left: PAGE_SIDE,
		right: PAGE_SIDE,
		backgroundColor: "#FFFFFF",
	},
	footer: {
		position: "absolute" as const,
		left: PAGE_SIDE,
		right: PAGE_SIDE,
		bottom: 22,
		paddingTop: 6,
		borderTopWidth: 1,
		borderTopColor: PDF_COLORS.rule,
		flexDirection: "row" as const,
		justifyContent: "space-between" as const,
		fontSize: 7,
		color: PDF_COLORS.muted,
	},
} as const;

/**
 * A flowing page of the payroll PDF: `header` is repeated at the top of every
 * physical page the content runs over (`headerHeight` reserves its space), and a
 * footer names the organization, the period and the page number. Sections such as
 * the day sheets, and a landscape absence calendar, render their pages with it.
 */
export function payrollPdfPage(
	context: PayrollPdfContext,
	options: {
		key: string;
		header: ReactNode;
		headerHeight: number;
		orientation?: "portrait" | "landscape";
		children: ReactNode;
	},
) {
	const { Page, View } = context.kit;
	return (
		<Page
			key={options.key}
			size="A4"
			orientation={options.orientation ?? "portrait"}
			style={[basePageStyle, { paddingTop: PAGE_TOP + options.headerHeight }]}
		>
			<View fixed style={frameStyles.header}>
				{options.header}
			</View>
			{options.children}
			<PayrollPdfFooter context={context} />
		</Page>
	);
}

/** Organization, period and "Page 2 of 9", fixed to the bottom of every page. */
export function PayrollPdfFooter({ context }: { context: PayrollPdfContext }) {
	const { Text, View } = context.kit;
	const { read, t } = context;
	return (
		<View fixed style={frameStyles.footer}>
			<Text>{`${read.summary.organizationName} · ${read.period.label}`}</Text>
			<Text
				render={({ pageNumber, totalPages }) =>
					t("payroll.pdf.pageNumber", "Page {page} of {pages}", {
						page: pageNumber,
						pages: totalPages ?? pageNumber,
					})
				}
			/>
		</View>
	);
}
