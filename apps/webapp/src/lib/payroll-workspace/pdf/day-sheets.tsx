import { Temporal } from "temporal-polyfill";
import { dayHasEntriesOrChange } from "@/lib/payroll-period/day-entries";
import type {
	PayrollPeriodDay,
	PayrollPeriodDayAbsence,
	PayrollPeriodDayRecord,
	PayrollPeriodEmployee,
} from "@/lib/payroll-period/types";
import type { PayrollPdfContext, PayrollPdfSection } from "./context";
import { PDF_COLORS } from "./page-styles";
import { payrollPdfPage } from "./page-frame";

/** Kicker, title, meta and column header; room for a wrapped meta line or column label. */
const HEADER_HEIGHT = 80;
/** The note line under the meta: days left out, and the not-approved marker. */
const NOTE_HEIGHT = 9;

/**
 * Portrait A4 leaves about 515 pt per row: the clock times fit "22:00 (-1)–06:00*" and
 * the breaks "12:00–12:31 (31 min)" on one line at 8 pt; longer cells wrap. Each record
 * is on its own line.
 */
const columns = {
	date: { width: "13%" },
	times: { width: "14%", paddingRight: 4 },
	breaks: { width: "16%", paddingRight: 4 },
	worked: { width: "8.5%", textAlign: "right" as const },
	required: { width: "8.5%", textAlign: "right" as const },
	difference: { width: "10.5%", textAlign: "right" as const },
	absence: { width: "14%", paddingLeft: 8 },
	settlement: { width: "15.5%", paddingLeft: 4 },
} as const;

/** Characters of a word that surely fit the narrowest wrapping column at 8 pt. */
const FITTING_WORD_LENGTH = 12;

/**
 * Narrow columns wrap between words: react-pdf would otherwise hyphenate short words
 * mid-word ("HOL- IDAY", "Abrech- nung"). A longer word, such as an absence category
 * "Elternzeit/Mutterschutz" users named, is hyphenated and, should a syllable still be
 * too long, split into pieces, so it stays inside its column instead of running into
 * the next one: react-pdf breaks a line only where this callback allows.
 */
function fittingWords(word: string, hyphenate?: (word: string) => string[]): string[] {
	if (word.length <= FITTING_WORD_LENGTH) return [word];
	return (hyphenate?.(word) ?? [word]).flatMap((part) => {
		const pieces: string[] = [];
		for (let index = 0; index < part.length; index += FITTING_WORD_LENGTH) {
			pieces.push(part.slice(index, index + FITTING_WORD_LENGTH));
		}
		return pieces;
	});
}

const styles = {
	kicker: {
		fontSize: 7,
		fontWeight: "bold" as const,
		color: PDF_COLORS.accent,
	},
	title: { fontSize: 13, fontWeight: "bold" as const, color: PDF_COLORS.ink, marginTop: 2 },
	meta: { fontSize: 8, color: PDF_COLORS.muted, marginTop: 2, marginBottom: 6 },
	note: { fontSize: 7, color: PDF_COLORS.muted, marginTop: -4, marginBottom: 4 },
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
	noEntries: {
		paddingVertical: 6,
		paddingHorizontal: 4,
		fontSize: 8,
		color: PDF_COLORS.muted,
	},
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

/** Marks a work or break record that is not approved yet (pending or draft). */
const NOT_APPROVED_MARKER = "*";

const NO_RECORDS: readonly PayrollPeriodDayRecord[] = [];

/**
 * One day sheet per employee in scope (#1900): a row per employee-local day of the
 * period with entries, showing the exact clock-in and clock-out times of each work record
 * and the breaks, worked, required and difference hours, absences and holiday, and the
 * settlement marker, ending in a total row. Days without entries or records are left out,
 * settled ones too (`isDayShown`); the totals still cover the whole period, so a sheet's
 * total matches the summary page. Figures come from the period read, the
 * times from the period's records, so a sheet matches the Days tab and its side panel.
 */
export const daySheetsSection: PayrollPdfSection = (context) =>
	context.read.employees.map((employee) => daySheet(context, employee));

function daySheet(context: PayrollPdfContext, employee: PayrollPeriodEmployee) {
	const { Text, View } = context.kit;
	const { read, t, format } = context;
	const recordsByDay = context.records.get(employee.id);
	const recordsOf = (day: PayrollPeriodDay) => recordsByDay?.get(day.date) ?? NO_RECORDS;
	const shownDays = employee.days.filter((day) =>
		isDayShown(day, recordsOf(day), read.period.start),
	);
	const anyNotApproved = shownDays.some((day) =>
		recordsOf(day).some((record) => record.approvalState !== "approved"),
	);
	const notes = [
		shownDays.length < employee.days.length
			? t("payroll.pdf.daySheet.daysLeftOut", "Days without entries are left out.")
			: null,
		anyNotApproved
			? t("payroll.pdf.daySheet.notApprovedLegend", "* Not approved yet (pending or draft)")
			: null,
	].filter((note) => note !== null);
	const meta = [
		employee.employeeNumber ?? t("payroll.pdf.noEmployeeNumber", "No employee no."),
		employee.teamName ?? t("payroll.pdf.noTeam", "No team"),
		t("payroll.pdf.daySheet.timezone", "Days in {timezone}", { timezone: employee.timezone }),
		`${read.period.label} (${format.date(read.period.start)} – ${format.date(read.period.end)})`,
	].join(" · ");

	return payrollPdfPage(context, {
		key: `day-sheet-${employee.id}`,
		headerHeight: HEADER_HEIGHT + (notes.length > 0 ? NOTE_HEIGHT : 0),
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
				{notes.length > 0 ? <Text style={styles.note}>{notes.join(" · ")}</Text> : null}
				<View style={styles.columnHeader}>
					<Text style={columns.date} hyphenationCallback={fittingWords}>
						{t("payroll.pdf.daySheet.date", "Date")}
					</Text>
					<Text style={columns.times} hyphenationCallback={fittingWords}>
						{t("payroll.pdf.daySheet.clockTimes", "Clock in – out")}
					</Text>
					<Text style={columns.breaks} hyphenationCallback={fittingWords}>
						{t("payroll.pdf.daySheet.breaks", "Breaks")}
					</Text>
					<Text style={columns.worked} hyphenationCallback={fittingWords}>
						{t("payroll.pdf.daySheet.worked", "Worked")}
					</Text>
					<Text style={columns.required} hyphenationCallback={fittingWords}>
						{t("payroll.pdf.daySheet.required", "Required")}
					</Text>
					<Text style={columns.difference} hyphenationCallback={fittingWords}>
						{t("payroll.pdf.daySheet.difference", "Difference")}
					</Text>
					<Text style={columns.absence} hyphenationCallback={fittingWords}>
						{t("payroll.pdf.daySheet.absenceHoliday", "Absence / holiday")}
					</Text>
					<Text style={columns.settlement} hyphenationCallback={fittingWords}>
						{t("payroll.pdf.daySheet.settlement", "Settlement")}
					</Text>
				</View>
			</>
		),
		children: (
			<>
				{shownDays.map((day) => daySheetRow(context, employee, day, recordsOf(day)))}
				{shownDays.length === 0 ? (
					<Text key="no-entries" style={styles.noEntries}>
						{t("payroll.pdf.daySheet.noEntries", "No entries in this period")}
					</Text>
				) : null}
				{totalRow(context, employee)}
			</>
		),
	});
}

/**
 * A day is on the sheet when the employee recorded anything on it, or it changed since
 * it was settled (`dayHasEntriesOrChange`), or a work or break record was recorded on it:
 * a pending or draft record is not credited, yet payroll must see it. A day settled with
 * nothing on it is left out. A running record counts on the day it started only (or the
 * period's first day, when it started before), not on every day up to now.
 */
function isDayShown(
	day: PayrollPeriodDay,
	records: readonly PayrollPeriodDayRecord[],
	periodStart: string,
): boolean {
	return (
		dayHasEntriesOrChange(day) ||
		records.some((record) => {
			if (record.end !== null) return true;
			const startDate = record.start.slice(0, 10);
			return startDate === day.date || (startDate < periodStart && day.date === periodStart);
		})
	);
}

function daySheetRow(
	context: PayrollPdfContext,
	employee: PayrollPeriodEmployee,
	day: PayrollPeriodDay,
	records: readonly PayrollPeriodDayRecord[],
) {
	const { Text, View } = context.kit;
	const { format } = context;
	const afterDeparture = employee.departure ? day.date > employee.departure.lastWorkingDay : false;
	const work = records.filter((record) => record.kind === "work");
	const breaks = records.filter((record) => record.kind === "break");
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
			<View style={columns.times}>
				{work.map((record) => recordLine(context, record, workText(context, record, day.date)))}
			</View>
			<View style={columns.breaks}>
				{breaks.map((record) => recordLine(context, record, breakText(context, record, day.date)))}
			</View>
			<Text style={columns.worked}>{format.hours(day.creditedMinutes)}</Text>
			<Text style={columns.required}>
				{day.requiredMinutes === null ? "–" : format.hours(day.requiredMinutes)}
			</Text>
			<Text style={columns.difference}>
				{day.differenceMinutes === null ? "–" : format.difference(day.differenceMinutes)}
			</Text>
			<View style={columns.absence}>
				{day.holiday ? <Text hyphenationCallback={fittingWords}>{day.holiday.name}</Text> : null}
				{day.absences.map((absence) => (
					<Text
						key={absence.absenceId}
						hyphenationCallback={fittingWords}
						style={absence.approvalState === "pending" ? styles.pending : undefined}
					>
						{absenceText(context, absence)}
					</Text>
				))}
			</View>
			{settlementMarker(context, day)}
		</View>
	);
}

/** One record on its own line; a record not approved yet is muted and marked. */
function recordLine(context: PayrollPdfContext, record: PayrollPeriodDayRecord, text: string) {
	const { Text } = context.kit;
	const approved = record.approvalState === "approved";
	return (
		<Text key={record.id} style={approved ? undefined : styles.pending}>
			{approved ? text : `${text}${NOT_APPROVED_MARKER}`}
		</Text>
	);
}

/** "08:02–12:00"; "22:00–06:00 (+1)" across midnight; "16:00–open" while it runs. */
function workText(context: PayrollPdfContext, record: PayrollPeriodDayRecord, date: string) {
	const { t } = context;
	const end = record.end
		? wallClock(record.end, date)
		: t("payroll.pdf.daySheet.openRecord", "open");
	return `${wallClock(record.start, date)}–${end}`;
}

/** "12:00–12:31 (31 min)", "10:00–10:15 (15 min, paid)". */
function breakText(context: PayrollPdfContext, record: PayrollPeriodDayRecord, date: string) {
	const { t } = context;
	const details = [
		record.durationMinutes === null
			? null
			: t("payroll.pdf.daySheet.breakMinutes", "{minutes} min", {
					minutes: record.durationMinutes,
				}),
		record.isPaid ? t("payroll.pdf.daySheet.paidBreak", "paid") : null,
	].filter((detail) => detail !== null);
	const times = workText(context, record, date);
	return details.length > 0 ? `${times} (${details.join(", ")})` : times;
}

/**
 * The local time of `localDateTime` (`YYYY-MM-DDTHH:mm`), with the days it lies before
 * or after the row's date when it is on another day: "06:00 (+1)", "22:00 (-1)".
 */
function wallClock(localDateTime: string, date: string): string {
	const time = localDateTime.slice(11, 16);
	const days = Temporal.PlainDate.from(localDateTime.slice(0, 10)).since(
		Temporal.PlainDate.from(date),
	).days;
	if (days === 0) return time;
	return `${time} (${days > 0 ? "+" : ""}${days})`;
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
			<Text style={[columns.settlement, styles.settled]} hyphenationCallback={fittingWords}>
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
				<Text style={styles.changed} hyphenationCallback={fittingWords}>
					{t("payroll.pdf.daySheet.changedSinceSettled", "Changed since settled")}
				</Text>
				<Text style={styles.changeDetails} hyphenationCallback={fittingWords}>
					{details}
				</Text>
			</View>
		);
	}
	return <Text style={columns.settlement} />;
}

/** Totals over every day of the period, the days left out included. */
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
			<Text style={columns.times} />
			<Text style={columns.breaks} />
			<Text style={columns.worked}>{format.hours(totals.creditedMinutes)}</Text>
			<Text style={columns.required}>
				{totals.requiredMinutes === null ? "–" : format.hours(totals.requiredMinutes)}
			</Text>
			<Text style={columns.difference}>
				{totals.differenceMinutes === null ? "–" : format.difference(totals.differenceMinutes)}
			</Text>
			<Text style={columns.absence} hyphenationCallback={fittingWords}>
				{totals.absenceDays > 0
					? t("payroll.pdf.daySheet.absenceDays", "{days} absence days", {
							days: format.days(totals.absenceDays),
						})
					: ""}
			</Text>
			<Text style={columns.settlement} hyphenationCallback={fittingWords}>
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
