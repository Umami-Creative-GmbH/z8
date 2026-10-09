"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { billableChoice } from "@/components/time-tracking/billable-choice";
import { BillableWorkSwitch } from "@/components/time-tracking/billable-work-switch";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/lib/calendar/types";

interface ClockOutOnBehalfDialogProps {
	open: boolean;
	/** The running work; its project and billability decide the billable toggle (#900). */
	work?: CalendarEvent | null;
	isPending: boolean;
	onOpenChange: (open: boolean) => void;
	/** `billable` is the explicit choice; undefined keeps the work's billability. */
	onConfirm: (billable?: boolean) => void;
}

export function ClockOutOnBehalfDialog({
	open,
	work,
	isPending,
	onOpenChange,
	onConfirm,
}: ClockOutOnBehalfDialogProps) {
	const { t } = useTranslate();
	const [billable, setBillable] = useState<{ workId: string; value: boolean } | null>(null);
	const metadata = work?.metadata;
	// The closure keeps the work's project, so the toggle starts from its billability.
	const choice = billableChoice({
		project: metadata?.projectId
			? { hasCustomer: metadata.projectHasCustomer ?? false, billableDefault: false }
			: null,
		explicit: billable && billable.workId === work?.id ? billable.value : undefined,
		kept: metadata?.isBillable ?? false,
	});

	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setBillable(null);
				onOpenChange(next);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("calendar.clockOutOnBehalf.title", "Clock out employee?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"calendar.clockOutOnBehalf.description",
							"This creates an auditable clock-out entry at the current server time. If anything needs adjustment afterward, use corrections.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{work ? (
					<BillableWorkSwitch
						choice={choice}
						onChange={(value) => setBillable({ workId: work.id, value })}
						disabled={isPending}
					/>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<Button type="button" disabled={isPending} onClick={() => onConfirm(choice.request)}>
						{isPending ? (
							<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
						) : null}
						{isPending
							? t("calendar.clockOutOnBehalf.loading", "Clocking out...")
							: t("calendar.clockOutOnBehalf.confirm", "Clock Out")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
