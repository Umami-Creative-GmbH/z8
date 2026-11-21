import type { ReactNode } from "react";
import type { PayrollPdfContext } from "./context";

import { PayrollPdfFooter } from "./page-footer";
import { basePageStyle, frameStyles, PAGE_TOP } from "./page-styles";
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
