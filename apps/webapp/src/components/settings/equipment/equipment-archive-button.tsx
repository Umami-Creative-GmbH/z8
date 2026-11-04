"use client";
import { IconArchive } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { EquipmentSetupChange } from "@/lib/organization/equipment/contracts";
import type { SubmitEquipment } from "./equipment-forms";

export function EquipmentArchiveButton({
	target,
	label,
	name,
	pending,
	submit,
}: {
	target: Omit<
		Extract<EquipmentSetupChange, { kind: "archive_type" | "archive_item" }>,
		"requestId"
	>;
	label: string;
	name: string;
	pending: boolean;
	submit: SubmitEquipment;
}) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const [requestId] = useState(() => crypto.randomUUID());
	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			<AlertDialogTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					disabled={pending}
					aria-label={label}
				>
					<IconArchive className="size-4" aria-hidden="true" />
					{t("settings.equipment.archive", "Archive")}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("settings.equipment.archiveTitle", "Archive equipment record?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.equipment.archiveDescription",
							"This record will no longer be offered for new work. Retained history and equipment identifiers stay reserved.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<p className="break-words font-medium">{name}</p>
				<AlertDialogFooter>
					<AlertDialogCancel>
						{t("settings.equipment.cancel", "Cancel")}
					</AlertDialogCancel>
					<Button
						onClick={() => {
							setOpen(false);
							void submit({ ...target, requestId });
						}}
					>
						{t("settings.equipment.confirmArchive", "Confirm archive")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
