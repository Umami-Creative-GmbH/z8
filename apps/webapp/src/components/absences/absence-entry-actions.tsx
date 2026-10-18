"use client";

import {
	IconCalendarCancel,
	IconEdit,
	IconPaperclip,
	IconUserShare,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AbsenceChangeKind } from "@/lib/absences/change-request-types";
import type { AbsenceWithCategory, AbsenceWithDays } from "@/lib/absences/types";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { useOwnAbsenceChanges } from "./use-own-absence-changes";

interface AbsenceEntryActionsProps {
	absence: AbsenceWithDays;
	currentDate: string;
	canAttachSickNote: boolean;
	changeRequests: ReturnType<typeof useOwnAbsenceChanges>["data"];
	changesLoaded: boolean;
	isCanceling: boolean;
	onRequestChange: (kind: AbsenceChangeKind) => void;
	onChangeDeputy: () => void;
	onAttachSickNote: () => void;
	onCancel: () => void;
}

function canShowCancelAction(absence: AbsenceWithDays): boolean {
	return absence.status === "pending";
}

/** The deputy can change on pending and approved absences until they have ended (#1011). */
function canChangeDeputy(absence: AbsenceWithCategory, today: string): boolean {
	return (
		(absence.status === "pending" || absence.status === "approved") &&
		comparePlainDates(parsePlainDate(absence.endDate), parsePlainDate(today)) >= 0
	);
}

/** The row actions of one of the employee's own absences in the absence table. */
export function AbsenceEntryActions({
	absence,
	currentDate,
	canAttachSickNote,
	changeRequests,
	changesLoaded,
	isCanceling,
	onRequestChange,
	onChangeDeputy,
	onAttachSickNote,
	onCancel,
}: AbsenceEntryActionsProps) {
	const { t } = useTranslate();
	const canCancel = canShowCancelAction(absence);
	const canRequestChange = absence.status === "approved";
	const pendingChange = changeRequests?.some(
		(request) => request.absenceId === absence.id && request.status === "pending",
	);
	const canChange = canChangeDeputy(absence, currentDate);
	if (!canCancel && !canAttachSickNote && !canChange && !canRequestChange) return null;
	const cancelLabel = t("absences.table.cancelAbsence", "Cancel absence");
	const cancelTooltip = t("absences.table.cancelAbsenceTooltip", "Cancel absence");
	const attachLabel = t("absences.sickNotes.attachAction", "Attach sick note");
	const changeDeputyLabel = t("absences.deputy.changeAction", "Change deputy");
	const requestChangeLabel = t("absences.change.request", "Request change");
	const requestCancellationLabel = t("absences.change.requestCancellation", "Request cancellation");

	return (
		<div className="flex justify-end gap-1">
			{canRequestChange ? (
				<>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								disabled={!changesLoaded || pendingChange}
								onClick={() => onRequestChange("change")}
								aria-label={requestChangeLabel}
							>
								<IconEdit aria-hidden="true" className="size-4" />
								<span className="sm:sr-only">{requestChangeLabel}</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>{requestChangeLabel}</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								disabled={!changesLoaded || pendingChange}
								onClick={() => onRequestChange("cancel")}
								aria-label={requestCancellationLabel}
							>
								<IconCalendarCancel aria-hidden="true" className="size-4" />
								<span className="sm:sr-only">{requestCancellationLabel}</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>{requestCancellationLabel}</TooltipContent>
					</Tooltip>
				</>
			) : null}
			{canChange ? (
				<Button variant="ghost" size="sm" onClick={onChangeDeputy} aria-label={changeDeputyLabel}>
					<IconUserShare aria-hidden="true" className="size-4" />
					<span className="sm:sr-only">{changeDeputyLabel}</span>
				</Button>
			) : null}
			{canAttachSickNote ? (
				<Button variant="ghost" size="sm" onClick={onAttachSickNote} aria-label={attachLabel}>
					<IconPaperclip aria-hidden="true" className="size-4" />
					<span className="sm:sr-only">{attachLabel}</span>
				</Button>
			) : null}
			{canCancel ? (
				<Tooltip>
					<AlertDialog>
						<TooltipTrigger asChild>
							<AlertDialogTrigger asChild>
								<Button variant="ghost" size="sm" disabled={isCanceling} aria-label={cancelLabel}>
									<IconX className="size-4" />
									{/* Touch screens cannot show the tooltip (#846). */}
									<span className="sm:sr-only">{cancelLabel}</span>
								</Button>
							</AlertDialogTrigger>
						</TooltipTrigger>
						<TooltipContent>{cancelTooltip}</TooltipContent>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>
									{t("absences.dialog.cancelTitle", "Cancel Absence")}
								</AlertDialogTitle>
								<AlertDialogDescription>
									{t(
										"absences.dialog.cancelDescription",
										"Are you sure you want to cancel this absence? This action cannot be undone.",
									)}
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
								<AlertDialogAction
									onClick={onCancel}
									className="bg-destructive text-white hover:bg-destructive/90"
								>
									{t("absences.dialog.confirmCancel", "Yes, cancel absence")}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</Tooltip>
			) : null}
		</div>
	);
}
