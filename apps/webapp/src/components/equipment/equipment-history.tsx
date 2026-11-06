"use client";
import { IconPencil } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Timeline, TimelineItem } from "@/components/ui/timeline";
import {
	comparePlainDates,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { conditionLabel } from "./equipment-copy";
import {
	type HistoryAssignment,
	type HistoryEntry,
	historyEntries,
} from "./equipment-history-entries";
import { useEquipmentDates } from "./equipment-status";

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
