"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type BaseUIPreventableEvent = { preventBaseUIHandler?: () => void };

/**
 * Confirms committing an import's accepted rows: how many, what committing
 * creates, and that there is no undo. The dialog stays open while the commit
 * starts and shows a failure inline; the caller closes it on success.
 */
export function ImportCommitConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	irreversibleNote,
	confirmLabel,
	pending,
	error,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	irreversibleNote: string;
	confirmLabel: string;
	pending: boolean;
	error: string | null;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen) => {
				// Escape or an outside press must not hide a commit that is still starting.
				if (!nextOpen && pending) return;
				onOpenChange(nextOpen);
			}}
		>
			<AlertDialogContent aria-busy={pending}>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<p className="font-medium text-sm">{irreversibleNote}</p>
				{error ? (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				) : null}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction
						disabled={pending}
						onClick={(event) => {
							// Keep the dialog open so the pending state and any failure stay visible.
							event.preventDefault();
							(event as unknown as BaseUIPreventableEvent).preventBaseUIHandler?.();
							if (pending) return;
							onConfirm();
						}}
					>
						{pending ? (
							<IconLoader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
						) : null}
						{pending ? t("settings.import.commitConfirm.pending", "Starting commit…") : confirmLabel}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
