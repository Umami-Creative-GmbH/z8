import type { PayrollPdfContext } from "./context";
import { frameStyles } from "./page-styles";
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
