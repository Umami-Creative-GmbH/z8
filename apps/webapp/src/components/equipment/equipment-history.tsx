"use client";
import { IconPencil } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import {
	comparePlainDates,
	parseInstant,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type {
	EquipmentAssignmentView,
	EquipmentExceptionView,
	EquipmentHandoverView,
} from "@/lib/organization/equipment/contracts";
import { conditionLabel } from "./equipment-copy";
import { useEquipmentDates } from "./equipment-status";

type Transfer = NonNullable<EquipmentAssignmentView["transfers"]>[number];

export type HistoryEntry =
	| {
			kind: "issue" | "receipt";
			key: string;
			/** The actual handover date; `null` only for an unknown historical issue date. */
			date: string | null;
			recordedAt: string;
			handover: EquipmentHandoverView;
			exception?: EquipmentExceptionView;
			transfer?: Transfer;
			amended: boolean;
	  }
	| {
			kind: "exception";
			key: string;
			date: string;
			recordedAt: string;
			exception: EquipmentExceptionView;
			amended: boolean;
	  }
	| { kind: "departure_deadline"; key: string; date: string }
	| { kind: "deadline_passed"; key: string; date: string };

type HistoryAssignment = Pick<
	EquipmentAssignmentView,
	| "issue"
	| "receipts"
	| "exceptions"
	| "corrections"
	| "transfers"
	| "departureDeadline"
	| "effectiveDeadline"
	| "overdue"
>;

/**
 * The assignment's history, newest first: handovers by their actual date,
 * exception decisions by the organization date they were recorded, and the
 * calendar milestones the record itself states (the departure deadline, and the
 * effective deadline once a return is overdue). Nothing gets a time it lacks; an
 * unknown historical issue date sorts as the oldest entry.
 */
export function historyEntries(
	assignment: HistoryAssignment,
	timezone: string,
): HistoryEntry[] {
	const corrections = assignment.corrections ?? [];
	const amendedHandover = (id: string) =>
		corrections.some((c) => c.handoverId === id);
	const transferOf = (id: string) =>
		assignment.transfers?.find((transfer) => transfer.handoverId === id);
	const entries: HistoryEntry[] = [
		{
			kind: "issue",
			key: `issue:${assignment.issue.id}`,
			date: assignment.issue.actualDate,
			recordedAt: assignment.issue.recordedAt,
			handover: assignment.issue,
			transfer: transferOf(assignment.issue.id),
			amended: amendedHandover(assignment.issue.id),
		},
		...assignment.receipts.map(
			(receipt): HistoryEntry => ({
				kind: "receipt",
				key: `receipt:${receipt.id}`,
				date: receipt.actualDate,
				recordedAt: receipt.recordedAt,
				handover: receipt,
				exception: assignment.exceptions?.find(
					(e) => e.id === receipt.exceptionId,
				),
				transfer: transferOf(receipt.id),
				amended: amendedHandover(receipt.id),
			}),
		),
		...(assignment.exceptions ?? []).map(
			(exception): HistoryEntry => ({
				kind: "exception",
				key: `exception:${exception.id}`,
				date: plainDateAt(
					parseInstant(exception.recordedAt),
					timezone,
				).toString(),
				recordedAt: exception.recordedAt,
				exception,
				amended: corrections.some((c) => c.exceptionId === exception.id),
			}),
		),
	];
	if (assignment.departureDeadline)
		entries.push({
			kind: "departure_deadline",
			key: "departure_deadline",
			date: assignment.departureDeadline,
		});
	if (assignment.overdue && assignment.effectiveDeadline)
		entries.push({
			kind: "deadline_passed",
			key: "deadline_passed",
			date: assignment.effectiveDeadline,
		});
	// A milestone closes its day, so it follows that day's recorded events; the
	// deadline passes after the departure that set it.
	const rank = (entry: HistoryEntry) =>
		entry.kind === "deadline_passed"
			? 2
			: entry.kind === "departure_deadline"
				? 1
				: 0;
	return entries.sort((left, right) => {
		if (left.date === null || right.date === null)
			return left.date === right.date ? 0 : left.date === null ? 1 : -1;
		return (
			comparePlainDates(
				parsePlainDate(right.date),
				parsePlainDate(left.date),
			) ||
			rank(right) - rank(left) ||
			("recordedAt" in right && "recordedAt" in left
				? parseInstant(right.recordedAt).epochMilliseconds -
					parseInstant(left.recordedAt).epochMilliseconds
				: 0)
		);
	});
}

type Translate = ReturnType<typeof useTranslate>["t"];

function handoverTitle(
	entry: Extract<HistoryEntry, { kind: "issue" | "receipt" }>,
	t: Translate,
) {
	const { handover, kind, exception } = entry;
	if (kind === "receipt" && handover.quantity === 0)
		return t(
			"settings.equipment.correction.voidedReceipt",
			"Receipt reversed by amendment",
		);
	if (handover.historical)
		return t("settings.equipment.historical.evidence", "Historical issuance");
	if (kind === "issue")
		return t("settings.equipment.custody.issuance", "Issuance");
	if (exception?.kind === "lost")
		return t("settings.equipment.exception.recovery", "Physical recovery");
	if (exception?.kind === "waived")
		return t(
			"settings.equipment.exception.waivedReceipt",
			"Physical receipt after waiver",
		);
	return t("settings.equipment.custody.receipt", "Physical receipt");
}

function AmendedBadge() {
	const { t } = useTranslate();
	return (
		<Badge variant="outline" className="gap-1">
			<IconPencil className="size-3" aria-hidden="true" />
			{t("settings.equipment.history.amended", "Amended")}
		</Badge>
	);
}

/** The vertical handover history; exception decisions offer recovery when the reader may record it. */
export function EquipmentHistory({
	assignment,
	timezone,
	today,
	pending = false,
	onReceiveException,
}: {
	assignment: HistoryAssignment;
	timezone: string;
	today: string;
	pending?: boolean;
	onReceiveException?: (exceptionId: string) => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const dates = useEquipmentDates(timezone);
	const recorded = (actorName: string | null, recordedAt: string) => (
		<>
			{t("settings.equipment.custody.recordedBy", "Recorded by")}{" "}
			<span>
				{actorName ??
					t("settings.equipment.custody.removedActor", "Removed account")}
			</span>{" "}
			· <time dateTime={recordedAt}>{dates.instant(recordedAt)}</time>{" "}
			<span translate="no">{timezone}</span>
		</>
	);
	return (
		<Timeline>
			{historyEntries(assignment, timezone).map((entry) => {
				if (
					entry.kind === "departure_deadline" ||
					entry.kind === "deadline_passed"
				)
					return (
						<TimelineItem
							key={entry.key}
							state={
								comparePlainDates(
									parsePlainDate(entry.date),
									parsePlainDate(today),
								) > 0
									? "upcoming"
									: "done"
							}
							title={
								entry.kind === "deadline_passed" ? (
									<span className="text-destructive">
										{t(
											"settings.equipment.history.deadlinePassed",
											"Return deadline passed",
										)}
									</span>
								) : (
									t(
										"settings.equipment.custody.departureDeadline",
										"Departure return deadline",
									)
								)
							}
							time={dates.date(entry.date)}
							dateTime={entry.date}
						>
							{entry.kind === "deadline_passed"
								? t(
										"settings.equipment.history.deadlinePassedHelp",
										"The return is outstanding after its effective deadline.",
									)
								: t(
										"settings.equipment.history.departureHelp",
										"The departure made required equipment due by this date.",
									)}
						</TimelineItem>
					);
				if (entry.kind === "exception") {
					const { exception } = entry;
					return (
						<TimelineItem
							key={entry.key}
							title={
								<span className="inline-flex flex-wrap items-center gap-2">
									{exception.kind === "lost"
										? t("settings.equipment.exception.lost", "Lost")
										: t(
												"settings.equipment.exception.waived",
												"Return waived",
											)}{" "}
									· {t("settings.equipment.handover.quantity", "Quantity")}:{" "}
									{exception.quantity.toLocaleString(locale)}
									{entry.amended ? <AmendedBadge /> : null}
								</span>
							}
							time={dates.date(entry.date)}
							dateTime={entry.date}
						>
							<p className="whitespace-pre-wrap text-foreground">
								{exception.reason}
							</p>
							<p className="tabular-nums">
								{exception.kind === "lost"
									? t(
											"settings.equipment.exception.recoveredQuantity",
											"Recovered quantity",
										)
									: t(
											"settings.equipment.exception.waivedReceivedQuantity",
											"Physically received after waiver",
										)}
								: {exception.receivedQuantity.toLocaleString(locale)}
							</p>
							<p>{recorded(exception.actorName, exception.recordedAt)}</p>
							{exception.canReceive && onReceiveException ? (
								<Button
									variant="outline"
									size="sm"
									className="mt-2"
									disabled={pending}
									onClick={() => onReceiveException(exception.id)}
								>
									{exception.kind === "lost"
										? t(
												"settings.equipment.exception.recover",
												"Record recovery",
											)
										: t(
												"settings.equipment.exception.receiveWaived",
												"Record waived receipt",
											)}
								</Button>
							) : null}
						</TimelineItem>
					);
				}
				const { handover } = entry;
				return (
					<TimelineItem
						key={entry.key}
						title={
							<span className="inline-flex flex-wrap items-center gap-2">
								{handoverTitle(entry, t)}
								{entry.amended ? <AmendedBadge /> : null}
							</span>
						}
						time={entry.date ? dates.date(entry.date) : undefined}
						dateTime={entry.date ?? undefined}
					>
						{entry.date === null ? (
							<p>
								{t(
									"settings.equipment.historical.dateUnknown",
									"Actual issue date unknown",
								)}
							</p>
						) : null}
						<p className="tabular-nums">
							{t("settings.equipment.handover.quantity", "Quantity")}:{" "}
							{handover.quantity.toLocaleString(locale)} ·{" "}
							{conditionLabel(handover.condition, t)}
						</p>
						{entry.transfer ? (
							<p>
								{entry.transfer.direction === "in"
									? entry.transfer.counterpartName
										? t(
												"settings.equipment.history.transferredFrom",
												"Transferred from {name}",
												{ name: entry.transfer.counterpartName },
											)
										: t(
												"settings.equipment.history.transferredIn",
												"Transferred from another holder",
											)
									: entry.transfer.counterpartName
										? t(
												"settings.equipment.history.transferredTo",
												"Transferred to {name}",
												{ name: entry.transfer.counterpartName },
											)
										: t(
												"settings.equipment.history.transferredOut",
												"Transferred to another holder",
											)}
							</p>
						) : null}
						{entry.exception ? (
							<p>
								{t(
									"settings.equipment.exception.linkedDecision",
									"Linked decision",
								)}
								: {entry.exception.reason}
							</p>
						) : null}
						{handover.notes ? (
							<p className="whitespace-pre-wrap text-foreground">
								{handover.notes}
							</p>
						) : null}
						<p>{recorded(handover.actorName, handover.recordedAt)}</p>
					</TimelineItem>
				);
			})}
		</Timeline>
	);
}
