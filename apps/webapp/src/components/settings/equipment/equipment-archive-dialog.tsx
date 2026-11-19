"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import type { EquipmentSetupChange } from "@/lib/organization/equipment/contracts";

export type EquipmentArchiveTarget = Omit<
	Extract<EquipmentSetupChange, { kind: "archive_type" | "archive_item" }>,
	"requestId"
> & { name: string };

/**
 * One-step confirmation before a type or item stops being offered for new work.
 * It stays open while the archive runs; the caller closes it on success.
 */
export function EquipmentArchiveDialog({
	target,
	pending = false,
	onClose,
	onConfirm,
}: {
	target: EquipmentArchiveTarget | null;
	pending?: boolean;
	onClose: () => void;
	onConfirm: (target: EquipmentArchiveTarget) => void;
}) {
	const { t } = useTranslate();
	// Keep the last target on screen while the dialog animates closed.
	const [shown, setShown] = useState(target);
	if (target && target !== shown) setShown(target);
	return (
		<ConfirmActionDialog
			open={target !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			variant="default"
			title={
				shown?.kind === "archive_item"
					? t("settings.equipment.items.archiveTitle", "Archive item?")
					: t("settings.equipment.types.archiveTitle", "Archive type?")
			}
			description={t(
				"settings.equipment.archiveDescription",
				"This record will no longer be offered for new work. Retained history and equipment identifiers stay reserved.",
			)}
			confirmLabel={t("settings.equipment.confirmArchive", "Confirm archive")}
			isPending={pending}
			onConfirm={() => {
				if (target) onConfirm(target);
			}}
		>
			<p className="break-words font-medium" translate="no">
				{shown?.name}
			</p>
		</ConfirmActionDialog>
	);
}
