"use client";

import { IconLoader2 } from "@tabler/icons-react";
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
} from "@/components/ui/alert-dialog";

/**
 * The "Delete …?" confirmation dialog of a settings list (holiday categories,
 * holidays): a title, what the deletion means, Cancel, and a destructive Delete
 * that shows a spinner while the deletion runs.
 */
export function DeleteConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	isDeleting,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	isDeleting: boolean;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleting}>
						{t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={onConfirm}
						disabled={isDeleting}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{isDeleting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{t("common.delete", "Delete")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
