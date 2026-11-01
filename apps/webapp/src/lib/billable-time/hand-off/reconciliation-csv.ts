/**
 * The reconciliation CSV (#1504): one row per comparison item with its draft,
 * customer, employee and day, the values as handed off, as last resolved and
 * now, the changed fields still open, the amount difference (#1502) and every
 * resolution. It only writes what the store already compared and priced;
 * nothing is recomputed.
 *
 * Times are ISO local date-times with the UTC offset the work recorded for
 * them (`docs/refs/timekeeping.md`), never the viewer's zone; resolution times
 * are UTC instants. An unknown amount difference has an empty amount, never 0,
 * and its kind and reason say why. Text cells are formula-safe
 * (`@/lib/export/csv-cells`). Pure and client-safe.
 */

import { csvFile, csvText, isCsvDecimal } from "@/lib/export/csv-cells";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import type {
	AmountDifferenceView,
	ComparedReferenceView,
	ComparedWorkValuesView,
	MarkedWorkItemView,
	RecordedTimeView,
	ResolutionHistoryEntryView,
} from "./views";

const VALUE_FIELDS = [
	"start",
	"end",
	"hours",
	"project",
	"customer",
	"billability",
	"removed",
] as const;

type ValueField = (typeof VALUE_FIELDS)[number];

const valueColumns = <const Prefix extends string>(prefix: Prefix) =>
	VALUE_FIELDS.map((field) => `${prefix}_${field}` as const);

const RESOLUTION_FIELDS = ["kind", "at", "actor", "explanation", "accounting_reference"] as const;

/** The columns before the resolutions; `resolution_<n>_*` follow for as many as the file needs. */
export const RECONCILIATION_CSV_COLUMNS = [
	"invoice_draft_id",
	"draft_title",
	"draft_accounting_reference",
	"customer",
	"invoiced_work_id",
	"employee",
	"day",
	"mark_status",
	"changed_fields",
	...valueColumns("hand_off"),
	"last_resolved_at",
	...valueColumns("last_resolved"),
	...valueColumns("current"),
	"amount_difference_kind",
	"amount_difference_reason",
	"amount_difference",
	"amount_difference_since_resolution_kind",
	"amount_difference_since_resolution_reason",
	"amount_difference_since_resolution",
	"currency",
	"new_customer_warning",
	"resolution_count",
] as const;

/** A recorded time at its own offset, e.g. `2026-03-02T09:00:00+01:00`. */
function recordedTime(time: RecordedTimeView | null): string {
	if (!time) return "";
	return parseInstant(time.at)
		.toZonedDateTimeISO(offsetMinutesToTimeZoneId(time.offsetMinutes))
		.toString({ timeZoneName: "never", smallestUnit: "second" });
}

function instant(at: string): string {
	return parseInstant(at).toString({ smallestUnit: "second" });
}

function decimal(value: string): string {
	if (!isCsvDecimal(value)) throw new RangeError(`Not a two-decimal amount: ${value}`);
	return value;
}

/** Names in order; a reference no longer found is written by id, none as empty. */
function references(list: readonly ComparedReferenceView[]): string {
	return list.map((reference) => reference.name ?? reference.id ?? "").join("; ");
}

/** One column of the comparison; empty when absent, and only `removed` once all of it is. */
function valueCells(values: ComparedWorkValuesView | null): Record<ValueField, string> {
	if (!values) {
		return Object.fromEntries(VALUE_FIELDS.map((field) => [field, csvText("")])) as Record<
			ValueField,
			string
		>;
	}
	const removed = values.removed ? "true" : values.removedPieceCount > 0 ? "partial" : "false";
	if (values.removed) {
		return {
			start: csvText(""),
			end: csvText(""),
			hours: "",
			project: csvText(""),
			customer: csvText(""),
			billability: csvText(""),
			removed: csvText(removed),
		};
	}
	return {
		start: csvText(recordedTime(values.start)),
		end: csvText(recordedTime(values.end)),
		hours: decimal(values.hours),
		project: csvText(references(values.projects)),
		customer: csvText(references(values.customers)),
		billability: csvText(values.billability),
		removed: csvText(removed),
	};
}

function prefixed<const Prefix extends string>(
	prefix: Prefix,
	cells: Record<ValueField, string>,
): Record<`${Prefix}_${ValueField}`, string> {
	return Object.fromEntries(
		VALUE_FIELDS.map((field) => [`${prefix}_${field}`, cells[field]]),
	) as Record<`${Prefix}_${ValueField}`, string>;
}

/** Kind, reason and amount; an unknown difference has no amount. */
function differenceCells(difference: AmountDifferenceView | null): [string, string, string] {
	if (!difference) return [csvText(""), csvText(""), ""];
	return [
		csvText(difference.kind),
		csvText(difference.reason),
		difference.kind === "unknown" ? "" : decimal(difference.amount),
	];
}

function resolutionCells(entry: ResolutionHistoryEntryView | undefined): string[] {
	if (!entry) return RESOLUTION_FIELDS.map(() => csvText(""));
	const resolution = entry.kind === "resolution" ? entry : null;
	return [
		csvText(entry.kind),
		csvText(instant(entry.at)),
		csvText(entry.actorName),
		csvText(resolution?.explanation),
		csvText(resolution?.accountingReference),
	];
}

/** The CSV of these items, in the order given. */
export function reconciliationCsv(items: readonly MarkedWorkItemView[]): string {
	// Oldest first, so resolution_1 is the first one recorded.
	const resolutions = items.map((item) => [...item.history].reverse());
	const resolutionColumns = Math.max(0, ...resolutions.map((list) => list.length));
	const header = [
		...RECONCILIATION_CSV_COLUMNS,
		...Array.from({ length: resolutionColumns }, (_, index) =>
			RESOLUTION_FIELDS.map((field) => `resolution_${index + 1}_${field}`),
		).flat(),
	];
	const rows = items.map((item, index) => {
		const { comparison } = item;
		const { amountDifference } = comparison;
		const [kind, reason, amount] = differenceCells(amountDifference.fromHandOff);
		const [sinceKind, sinceReason, sinceAmount] = differenceCells(amountDifference.sinceResolution);
		const cells: Record<(typeof RECONCILIATION_CSV_COLUMNS)[number], string> = {
			invoice_draft_id: csvText(item.invoiceDraftId),
			draft_title: csvText(item.draft.title),
			draft_accounting_reference: csvText(item.draft.externalId),
			customer: csvText(item.draft.customerName),
			invoiced_work_id: csvText(item.invoicedWorkId),
			employee: csvText(item.employeeName),
			day: csvText(item.day),
			mark_status: csvText(item.changedAfterInvoicingAt === null ? "resolved" : "open"),
			changed_fields: csvText(item.changedFields.join("; ")),
			...prefixed("hand_off", valueCells(comparison.handOff)),
			last_resolved_at: csvText(
				comparison.lastResolved ? instant(comparison.lastResolved.resolvedAt) : "",
			),
			...prefixed("last_resolved", valueCells(comparison.lastResolved)),
			...prefixed("current", valueCells(comparison.current)),
			amount_difference_kind: kind,
			amount_difference_reason: reason,
			amount_difference: amount,
			amount_difference_since_resolution_kind: sinceKind,
			amount_difference_since_resolution_reason: sinceReason,
			amount_difference_since_resolution: sinceAmount,
			currency: csvText(amountDifference.currency),
			new_customer_warning: csvText(String(amountDifference.notOnHandOffForNewCustomer)),
			resolution_count: String(resolutions[index].length),
		};
		return [
			...RECONCILIATION_CSV_COLUMNS.map((column) => cells[column]),
			...Array.from({ length: resolutionColumns }, (_, position) =>
				resolutionCells(resolutions[index][position]),
			).flat(),
		];
	});
	return csvFile(header, rows);
}
