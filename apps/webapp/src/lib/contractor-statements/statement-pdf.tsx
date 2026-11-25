import "server-only";

import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { Temporal } from "temporal-polyfill";
import { formatBillableAmount, formatBillableHours } from "@/lib/billable-time/format";
import { dayUnitRuleLabel } from "@/lib/contractor-compensation/day-unit-rule-label";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	awaitingApprovalNotice,
	basisLabel,
	type StatementLabels,
	type StatementTranslate,
	statementLabels,
	unitLabel,
} from "./labels";
import {
	type ContractorStatement,
	STATEMENT_UNIT_SCALE,
	type StatementDay,
	type StatementLine,
} from "./statement";

/**
 * The Contractor Time & Fee Statement as PDF (#2000): the same statement as
 * the CSV, for people. Labelled a verification statement at the top and in
 * every page's footer, never an invoice or Gutschrift. Dates, amounts and
 * units are formatted for the exporter's `locale`; every figure is the
 * statement's (the pricing engine's), never recomputed.
 */

const ink = "#172033";
const muted = "#5b6474";
const rule = "#dbe3ef";

const styles = StyleSheet.create({
	page: {
		paddingTop: 36,
		paddingBottom: 52,
		paddingHorizontal: 36,
		fontFamily: "Helvetica",
		fontSize: 8.5,
		lineHeight: 1.35,
		color: ink,
	},
	kicker: { fontSize: 8, color: muted, marginBottom: 2 },
	title: { fontSize: 17, fontFamily: "Helvetica-Bold", marginBottom: 8 },
	notice: {
		borderWidth: 1,
		borderColor: ink,
		padding: 8,
		marginBottom: 12,
		fontFamily: "Helvetica-Bold",
	},
	details: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8, marginRight: -16 },
	// A gutter between the columns; long names, companies and references wrap in their cell.
	detail: { width: "50%", flexDirection: "row", marginBottom: 3, paddingRight: 16 },
	detailLabel: { width: 132, flexShrink: 0, paddingRight: 8, color: muted },
	detailValue: { flex: 1, minWidth: 0 },
	note: { color: muted, fontSize: 7.5, marginBottom: 10 },
	heading: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 5 },
	tableHeader: {
		flexDirection: "row",
		borderBottomWidth: 1,
		borderBottomColor: ink,
		paddingBottom: 3,
		marginBottom: 2,
		fontFamily: "Helvetica-Bold",
	},
	dayRow: {
		flexDirection: "row",
		borderTopWidth: 1,
		borderTopColor: rule,
		paddingTop: 4,
		paddingBottom: 2,
		fontFamily: "Helvetica-Bold",
	},
	lineRow: { flexDirection: "row", paddingBottom: 2, color: ink },
	totalRow: {
		flexDirection: "row",
		borderTopWidth: 1,
		borderTopColor: ink,
		paddingTop: 4,
		fontFamily: "Helvetica-Bold",
	},
	colDate: { width: 78 },
	colTime: { width: 112, paddingRight: 6 },
	colWork: { flex: 1, paddingRight: 6 },
	colWorked: { width: 52, textAlign: "right" },
	colUnits: { width: 72, textAlign: "right" },
	colAmount: { width: 68, textAlign: "right" },
	subtle: { color: muted, fontFamily: "Helvetica" },
	footer: {
		position: "absolute",
		// A fixed top (A4 is 841.89 pt high): react-pdf drops a bottom-anchored
		// footer from pages the content flows over.
		top: 812,
		left: 36,
		right: 36,
		fontSize: 7,
		color: muted,
		flexDirection: "row",
		justifyContent: "space-between",
	},
});

interface Format {
	date: (iso: string) => string;
	money: (amount: string, currency: string) => string;
	units: (units: string, unit: "hour" | "day") => string;
	hours: (minutes: number) => string;
}

function formatter(locale: string, labels: StatementLabels): Format {
	return {
		date: (iso) => formatPlainDate(Temporal.PlainDate.from(iso), locale, "dateMedium"),
		money: (amount, currency) => formatBillableAmount(locale, amount, currency),
		// The statement's own scale (as in the CSV), so days and totals add up as printed.
		units: (units, unit) =>
			`${formatBillableHours(locale, units, STATEMENT_UNIT_SCALE)} ${unitLabel(labels, unit)}`,
		hours: (minutes) => `${formatBillableHours(locale, minutes / 60, 2)} h`,
	};
}

/**
 * "09:00–12:00 UTC+01:00": the line's local start and end with the offset the
 * work recorded (both are at the start's offset, see `statement.ts`).
 */
const timeRange = (line: StatementLine) =>
	`${line.start.slice(11, 16)}–${line.end.slice(11, 16)} UTC${line.start.slice(16)}`;

function Detail({ label, value }: { label: string; value: string | null }) {
	if (!value) return null;
	return (
		<View style={styles.detail}>
			<Text style={styles.detailLabel}>{label}</Text>
			<Text style={styles.detailValue}>{value}</Text>
		</View>
	);
}

function DayRows({
	day,
	t,
	labels,
	format,
}: {
	day: StatementDay;
	t: StatementTranslate;
	labels: StatementLabels;
	format: Format;
}) {
	const pricing = day.pricing;
	const terms = pricing
		? [
				`${basisLabel(labels, pricing.basis)} ${format.money(pricing.rate, pricing.currency)}`,
				pricing.dayUnitRule ? dayUnitRuleLabel(t, pricing.dayUnitRule) : null,
			]
				.filter(Boolean)
				.join(" · ")
		: labels.noRate;
	// A day may span pages (many work lines); only a single row never breaks, and
	// the day's header row keeps at least its first line with it.
	return (
		<View>
			<View style={styles.dayRow} wrap={false} minPresenceAhead={14}>
				<Text style={styles.colDate}>{format.date(day.date)}</Text>
				<Text style={[styles.colTime, styles.subtle]} />
				<Text style={[styles.colWork, styles.subtle]}>{terms}</Text>
				<Text style={styles.colWorked}>{format.hours(day.workedMinutes)}</Text>
				<Text style={styles.colUnits}>
					{pricing ? format.units(pricing.units, pricing.unit) : ""}
				</Text>
				<Text style={styles.colAmount}>
					{pricing ? format.money(pricing.amount, pricing.currency) : ""}
				</Text>
			</View>
			{day.lines.map((line) => (
				<View key={`${line.workId}-${line.start}`} style={styles.lineRow} wrap={false}>
					<Text style={styles.colDate} />
					<Text style={styles.colTime}>{timeRange(line)}</Text>
					<Text style={styles.colWork}>
						{[line.projectName ?? labels.noProject, line.taskName].filter(Boolean).join(" / ")}
					</Text>
					<Text style={styles.colWorked}>{format.hours(line.workedMinutes)}</Text>
					<Text style={styles.colUnits} />
					<Text style={styles.colAmount}>
						{line.amount && pricing ? format.money(line.amount, pricing.currency) : ""}
					</Text>
				</View>
			))}
		</View>
	);
}

export async function renderContractorStatementPdf(
	statement: ContractorStatement,
	options: { t: StatementTranslate; locale: string },
): Promise<Uint8Array> {
	const { t, locale } = options;
	const labels = statementLabels(t);
	const format = formatter(locale, labels);
	const { contractor } = statement;
	const isNonZero = (value: string) => !/^0(\.0+)?$/.test(value);

	const buffer = await renderToBuffer(
		<Document title={labels.title} author={statement.organizationName} creator="Z8">
			<Page size="A4" style={styles.page}>
				<View fixed style={styles.footer}>
					<Text>{labels.title}</Text>
					<Text
						render={({ pageNumber, totalPages }) => `${labels.page} ${pageNumber} / ${totalPages}`}
					/>
				</View>

				<Text style={styles.kicker}>{statement.organizationName}</Text>
				<Text style={styles.title}>{labels.title}</Text>
				<Text style={styles.notice}>{labels.notice}</Text>

				<View style={styles.details}>
					<Detail label={labels.contractor} value={contractor.name} />
					<Detail label={labels.contractorNumber} value={contractor.employeeNumber} />
					<Detail label={labels.company} value={contractor.companyName} />
					<Detail label={labels.vatId} value={contractor.vatId} />
					<Detail label={labels.referenceCode} value={contractor.referenceCode} />
					<Detail
						label={labels.period}
						value={`${format.date(statement.period.fromDay)} – ${format.date(statement.period.toDay)}`}
					/>
					<Detail label={labels.organization} value={statement.organizationName} />
					<Detail label={labels.generated} value={statement.generatedAt} />
				</View>
				<Text style={styles.note}>
					{labels.times} {labels.approvedOnly}
					{statement.awaitingApprovalWorkPeriods > 0
						? ` ${awaitingApprovalNotice(t, statement.awaitingApprovalWorkPeriods)}`
						: ""}
				</Text>

				{statement.days.length === 0 ? (
					<Text>{labels.empty}</Text>
				) : (
					<View>
						<View style={styles.tableHeader} fixed>
							<Text style={styles.colDate}>{labels.date}</Text>
							<Text style={styles.colTime}>{labels.time}</Text>
							<Text style={styles.colWork}>
								{labels.project} / {labels.task}
							</Text>
							<Text style={styles.colWorked}>{labels.workedHours}</Text>
							<Text style={styles.colUnits}>{labels.units}</Text>
							<Text style={styles.colAmount}>{labels.amount}</Text>
						</View>
						{statement.days.map((day) => (
							<DayRows
								key={`${day.date}-${day.lines[0]?.workId ?? ""}`}
								day={day}
								t={t}
								labels={labels}
								format={format}
							/>
						))}
					</View>
				)}

				{statement.totals.length > 0 && (
					<View>
						<Text style={styles.heading} minPresenceAhead={24}>
							{labels.totals}
						</Text>
						{statement.totals.map((total) => (
							<View key={total.currency} style={styles.totalRow} wrap={false}>
								<Text style={styles.colDate}>{labels.rowTotal}</Text>
								<Text style={styles.colTime}>{total.currency}</Text>
								<Text style={[styles.colWork, styles.subtle]}>
									{[
										isNonZero(total.hours) ? format.units(total.hours, "hour") : null,
										isNonZero(total.days) ? format.units(total.days, "day") : null,
									]
										.filter(Boolean)
										.join(" · ")}
								</Text>
								<Text style={styles.colWorked}>{format.hours(total.workedMinutes)}</Text>
								<Text style={styles.colUnits} />
								<Text style={styles.colAmount}>{format.money(total.amount, total.currency)}</Text>
							</View>
						))}
					</View>
				)}

				{statement.projects.length > 0 && (
					<View>
						<Text style={styles.heading} minPresenceAhead={24}>
							{labels.byProject}
						</Text>
						{statement.projects.map((project) => (
							<View
								key={`${project.projectName ?? ""}-${project.currency}`}
								style={styles.lineRow}
								wrap={false}
							>
								<Text style={styles.colWork}>{project.projectName ?? labels.noProject}</Text>
								<Text style={styles.colWorked}>{format.hours(project.workedMinutes)}</Text>
								<Text style={styles.colAmount}>
									{format.money(project.amount, project.currency)}
								</Text>
							</View>
						))}
					</View>
				)}

				{statement.unpriced.days > 0 && (
					<Text style={[styles.note, { marginTop: 10 }]}>
						{labels.unpricedNotice} {labels.rowUnpriced}:{" "}
						{format.hours(statement.unpriced.workedMinutes)}
					</Text>
				)}
			</Page>
		</Document>,
	);
	return new Uint8Array(buffer);
}
