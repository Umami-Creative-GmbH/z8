/**
 * PDF export of a report document (modeled on `pdf-exporter.tsx`): landscape
 * A4 with the facts, each table and the notes.
 * NOTE: @react-pdf/renderer is imported dynamically to keep it out of the
 * initial bundle.
 */

import { formatReportCell, type ReportCell, type ReportDocument } from "./report-document";

const styleDefinitions = {
	page: { padding: 32, fontSize: 9, fontFamily: "Helvetica" },
	title: { fontSize: 18, marginBottom: 12, fontWeight: "bold" },
	fact: { flexDirection: "row", marginBottom: 3 },
	factLabel: { width: "30%", fontWeight: "bold" },
	factValue: { width: "70%" },
	tableTitle: {
		fontSize: 12,
		fontWeight: "bold",
		marginTop: 14,
		marginBottom: 6,
		backgroundColor: "#E0E0E0",
		padding: 4,
	},
	headerRow: {
		flexDirection: "row",
		backgroundColor: "#4472C4",
		color: "white",
		fontWeight: "bold",
		padding: 4,
	},
	row: {
		flexDirection: "row",
		borderBottomWidth: 1,
		borderBottomColor: "#CCCCCC",
		padding: 4,
	},
	totalsRow: { flexDirection: "row", backgroundColor: "#E0E0E0", fontWeight: "bold", padding: 4 },
	cell: { flex: 1, paddingRight: 4 },
	firstCell: { flex: 2, paddingRight: 4 },
	note: { marginTop: 4, color: "#444444" },
	notes: { marginTop: 14 },
	footer: {
		position: "absolute",
		bottom: 20,
		left: 32,
		right: 32,
		textAlign: "center",
		fontSize: 8,
		color: "#666666",
	},
} as const;

export async function exportReportDocumentToPDF(document: ReportDocument): Promise<Uint8Array> {
	const { Document, Page, pdf, StyleSheet, Text, View } = await import("@react-pdf/renderer");
	const styles = StyleSheet.create(styleDefinitions);

	const ReportPDF = () => (
		<Document title={document.title}>
			<Page size="A4" orientation="landscape" style={styles.page}>
				<Text style={styles.title}>{document.title}</Text>
				{document.facts.map((fact) => (
					<View key={fact.label} style={styles.fact}>
						<Text style={styles.factLabel}>{fact.label}</Text>
						<Text style={styles.factValue}>{fact.value}</Text>
					</View>
				))}

				{document.tables.map((table) => {
					const cells = (row: readonly ReportCell[]) =>
						row.map((cell, index) => (
							<Text
								// biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
								key={index}
								style={index === 0 ? styles.firstCell : styles.cell}
							>
								{formatReportCell(cell, table.columns[index]?.kind ?? "text", document.unknownLabel)}
							</Text>
						));
					return (
						<View key={table.title} wrap>
							<Text style={styles.tableTitle}>{table.title}</Text>
							<View style={styles.headerRow} fixed>
								{table.columns.map((column, index) => (
									<Text key={column.key} style={index === 0 ? styles.firstCell : styles.cell}>
										{column.header}
									</Text>
								))}
							</View>
							{table.rows.map((row, rowIndex) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
								<View key={rowIndex} style={styles.row} wrap={false}>
									{cells(row)}
								</View>
							))}
							{table.totals && (
								<View style={styles.totalsRow} wrap={false}>
									{cells(table.totals)}
								</View>
							)}
						</View>
					);
				})}

				{document.notes.length > 0 && (
					<View style={styles.notes}>
						{document.notes.map((note) => (
							<Text key={note} style={styles.note}>
								{note}
							</Text>
						))}
					</View>
				)}

				<Text style={styles.footer} fixed>
					{document.footer}
				</Text>
			</Page>
		</Document>
	);

	const blob = await pdf(<ReportPDF />).toBlob();
	return new Uint8Array(await blob.arrayBuffer());
}
