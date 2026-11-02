"use client";

import { IconPointFilled } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useDisplayContext } from "@/hooks/use-display-context";
import type {
	ComparedField,
	ComparedReferenceView,
	ComparedWorkValuesView,
	RecordedTimeView,
	WorkComparisonView,
} from "@/lib/billable-time/hand-off/views";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	formatCapturedOffsetInstant,
	formatInstant,
	formatUtcOffset,
	workDayOf,
} from "@/lib/datetime/temporal-format";
import { cn } from "@/lib/utils";
import { useHandOffLabels } from "./hand-off-labels";

type Column = {
	key: "handOff" | "lastResolved" | "current";
	values: ComparedWorkValuesView;
	/** Differs from the hand-off. */
	changed: readonly ComparedField[];
	/** Differs from the last resolution (the current column only). */
	sinceResolution: readonly ComparedField[];
};

const ROWS: readonly ComparedField[] = [
	"day",
	"start",
	"end",
	"hours",
	"project",
	"customer",
	"billability",
	"removed",
];

/**
 * A comparison item's values as handed off, as last resolved and now (#1501).
 * Values that differ from the hand-off are highlighted; a dot marks current
 * values changed since the last resolution. Times are shown at the offsets
 * the work recorded, never in the viewer's time zone.
 */
export function WorkComparison({
	comparison,
	label,
}: {
	comparison: WorkComparisonView;
	/** Names the item for screen readers. */
	label: string;
}) {
	const { t } = useTranslate();
	const display = useDisplayContext();
	const labels = useHandOffLabels();
	const { handOff, lastResolved, current } = comparison;
	const columns: Column[] = [
		{ key: "handOff", values: handOff, changed: [], sinceResolution: [] },
		...(lastResolved
			? [
					{
						key: "lastResolved" as const,
						values: lastResolved,
						changed: lastResolved.changedFromHandOff,
						sinceResolution: [],
					},
				]
			: []),
		{
			key: "current",
			values: current,
			changed: current.changedFromHandOff,
			sinceResolution: current.changedSinceResolution ?? [],
		},
	];
	const offsets = new Set(
		columns.flatMap(({ values }) =>
			[values.start, values.end].flatMap((time) => (time ? [time.offsetMinutes] : [])),
		),
	);
	const showOffsets = offsets.size > 1;

	const time = (value: RecordedTimeView | null, day: string | null): string => {
		if (!value) return "—";
		const instant = parseInstant(value.at);
		const clock = formatCapturedOffsetInstant(instant, {
			locale: display.locale,
			timeFormat: display.timeFormat,
			offsetMinutes: value.offsetMinutes,
			preset: "time",
		});
		const ownDay = workDayOf(instant, value.offsetMinutes).toString();
		const clockOnDay =
			day !== null && ownDay !== day
				? t("settings.billableTime.handOff.comparison.timeOnDay", "{day} {time}", {
						day: labels.day(ownDay),
						time: clock,
					})
				: clock;
		return showOffsets
			? t("settings.billableTime.handOff.comparison.timeWithOffset", "{time} ({offset})", {
					time: clockOnDay,
					offset: formatUtcOffset(value.offsetMinutes),
				})
			: clockOnDay;
	};

	const references = (
		values: readonly ComparedReferenceView[],
		none: string,
		unknown: string,
	): string =>
		values
			.map((reference) => (reference.id === null ? none : (reference.name ?? unknown)))
			.join(", ");

	/** A field's value in one column. */
	const cellText = (field: ComparedField, values: ComparedWorkValuesView): string => {
		if (field === "removed") {
			if (values.removed) return t("settings.billableTime.handOff.comparison.removedYes", "Yes");
			if (values.removedPieceCount > 0) {
				return t(
					"settings.billableTime.handOff.comparison.removedPieces",
					"{removed} of {count} pieces",
					{ removed: values.removedPieceCount, count: values.pieceCount },
				);
			}
			return t("settings.billableTime.handOff.comparison.removedNo", "No");
		}
		if (values.removed) return "—";
		switch (field) {
			case "day":
				return values.day ? labels.day(values.day) : "—";
			case "start":
				return time(values.start, values.day);
			case "end":
				return time(values.end, values.day);
			case "hours":
				return labels.hoursWithUnit(values.hours);
			case "project":
				return references(
					values.projects,
					t("settings.billableTime.handOff.comparison.noProject", "No project"),
					t("settings.billableTime.handOff.comparison.unknownProject", "Unknown project"),
				);
			case "customer":
				return references(
					values.customers,
					t("settings.billableTime.handOff.comparison.noCustomer", "No customer"),
					t("settings.billableTime.handOff.comparison.unknownCustomer", "Unknown customer"),
				);
			case "billability":
				switch (values.billability) {
					case "billable":
						return t("settings.billableTime.handOff.comparison.billable", "Billable");
					case "non_billable":
						return t("settings.billableTime.handOff.comparison.nonBillable", "Not billable");
					case "mixed":
						return t("settings.billableTime.handOff.comparison.mixedBillable", "Partly billable");
					default:
						return "—";
				}
		}
	};

	const fieldLabel = (field: ComparedField): string => {
		switch (field) {
			case "day":
				return t("settings.billableTime.handOff.comparison.day", "Day");
			case "start":
				return t("settings.billableTime.handOff.comparison.start", "Start");
			case "end":
				return t("settings.billableTime.handOff.comparison.end", "End");
			case "hours":
				return t("settings.billableTime.handOff.comparison.hours", "Hours");
			case "project":
				return t("settings.billableTime.handOff.comparison.project", "Project");
			case "customer":
				return t("settings.billableTime.handOff.comparison.customer", "Customer");
			case "billability":
				return t("settings.billableTime.handOff.comparison.billability", "Billability");
			case "removed":
				return t("settings.billableTime.handOff.comparison.removed", "Removed");
		}
	};

	const header = (column: Column): ReactNode => {
		switch (column.key) {
			case "handOff":
				return t("settings.billableTime.handOff.comparison.handOff", "Hand-off");
			case "current":
				return t("settings.billableTime.handOff.comparison.current", "Current");
			case "lastResolved":
				return (
					<>
						{t("settings.billableTime.handOff.comparison.lastResolved", "Last resolved")}
						{lastResolved && (
							<span className="block font-normal text-muted-foreground text-xs">
								{formatInstant(parseInstant(lastResolved.resolvedAt), display, "dateMedium")}
							</span>
						)}
					</>
				);
		}
	};

	return (
		<div className="space-y-2">
			<div className="overflow-x-auto rounded-md border">
				<table className="w-full min-w-[28rem] text-sm">
					<caption className="sr-only">
						{t("settings.billableTime.handOff.comparison.caption", "Comparison of {item}", {
							item: label,
						})}
					</caption>
					<thead className="bg-muted/40 text-left">
						<tr>
							<th scope="col" className="px-3 py-2 font-medium text-muted-foreground">
								{t("settings.billableTime.handOff.comparison.field", "Field")}
							</th>
							{columns.map((column) => (
								<th key={column.key} scope="col" className="px-3 py-2 align-top font-medium">
									{header(column)}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="divide-y">
						{ROWS.map((field) => (
							<tr key={field}>
								<th scope="row" className="px-3 py-1.5 text-left font-normal text-muted-foreground">
									{fieldLabel(field)}
								</th>
								{columns.map((column) => {
									const changed = column.changed.includes(field);
									const since = column.sinceResolution.includes(field);
									return (
										<td
											key={column.key}
											data-changed={changed ? "hand-off" : undefined}
											className={cn(
												"px-3 py-1.5 tabular-nums",
												changed && "bg-amber-500/10 font-medium",
											)}
										>
											{cellText(field, column.values)}
											{since && (
												<IconPointFilled
													aria-hidden="true"
													className="ml-1 inline size-3 text-amber-600 dark:text-amber-400"
												/>
											)}
											{changed && (
												<span className="sr-only">
													{t(
														"settings.billableTime.handOff.comparison.changedFromHandOff",
														"(changed from the hand-off)",
													)}
												</span>
											)}
											{since && (
												<span className="sr-only">
													{t(
														"settings.billableTime.handOff.comparison.changedSinceResolution",
														"(changed since the last resolution)",
													)}
												</span>
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="space-y-1 text-muted-foreground text-xs">
				<p>
					{t(
						"settings.billableTime.handOff.comparison.legend",
						"Highlighted values differ from the hand-off. Times are local to where the work was recorded.",
					)}
				</p>
				{lastResolved && (
					<p className="flex items-center gap-1">
						<IconPointFilled
							aria-hidden="true"
							className="size-3 text-amber-600 dark:text-amber-400"
						/>
						{t(
							"settings.billableTime.handOff.comparison.legendSinceResolution",
							"Changed since the last resolution.",
						)}
					</p>
				)}
				{current.pieceCount > 1 && (
					<p>
						{t(
							"settings.billableTime.handOff.comparison.pieces",
							"Current values cover {count} pieces split from this work; hours are their sum.",
							{ count: current.pieceCount },
						)}
					</p>
				)}
			</div>
		</div>
	);
}
