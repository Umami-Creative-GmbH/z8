"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
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

interface ClockOutOnBehalfDialogProps {
	open: boolean;
	isPending: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}

export function ClockOutOnBehalfDialog({
	open,
	isPending,
	onOpenChange,
	onConfirm,
}: ClockOutOnBehalfDialogProps) {
	const { t } = useTranslate();

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
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
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<Button type="button" disabled={isPending} onClick={onConfirm}>
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
