"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import type { EquipmentSetupChange } from "@/lib/organization/equipment/contracts";

export type EquipmentArchiveTarget = Omit<
	Extract<EquipmentSetupChange, { kind: "archive_type" | "archive_item" }>,
	"requestId"
> & { name: string };

/** One-step confirmation before a type or item stops being offered for new work. */
export function EquipmentArchiveDialog({
	target,
	onClose,
	onConfirm,
}: {
	target: EquipmentArchiveTarget | null;
	onClose: () => void;
	onConfirm: (target: EquipmentArchiveTarget) => void;
}) {
	const { t } = useTranslate();
	// Keep the last target on screen while the dialog animates closed.
	const [shown, setShown] = useState(target);
	if (target && target !== shown) setShown(target);
	return (
		<AlertDialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{shown?.kind === "archive_item"
							? t("settings.equipment.items.archiveTitle", "Archive item?")
							: t("settings.equipment.types.archiveTitle", "Archive type?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.equipment.archiveDescription",
							"This record will no longer be offered for new work. Retained history and equipment identifiers stay reserved.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<p className="break-words font-medium" translate="no">
					{shown?.name}
				</p>
				<AlertDialogFooter>
					<AlertDialogCancel>
						{t("settings.equipment.cancel", "Cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							if (target) onConfirm(target);
						}}
					>
						{t("settings.equipment.confirmArchive", "Confirm archive")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
