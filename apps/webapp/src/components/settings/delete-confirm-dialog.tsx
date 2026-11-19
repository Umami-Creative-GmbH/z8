"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";

/**
 * The "Delete …?" confirmation dialog of a settings list (holiday categories,
 * holidays, policies …): a title, what the deletion means, Cancel, and a
 * destructive Delete that shows a spinner while the deletion runs. The dialog
 * stays open while the deletion runs; the caller closes it when the mutation
 * settles. A failure passed as `error` stays visible inline.
 */
export function DeleteConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	isDeleting,
	onConfirm,
	error,
	confirmLabel,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	description: ReactNode;
	isDeleting: boolean;
	onConfirm: () => void;
	error?: string | null;
	/** Defaults to "Delete". */
	confirmLabel?: ReactNode;
	children?: ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<ConfirmActionDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			description={description}
			confirmLabel={confirmLabel ?? t("common.delete", "Delete")}
			isPending={isDeleting}
			error={error}
			onConfirm={onConfirm}
		>
			{children}
		</ConfirmActionDialog>
	);
}
