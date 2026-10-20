"use client";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { toast } from "sonner";
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
import type { DrivingLicenceEnding } from "@/lib/organization/driving-licence/intended-driver-rules";

type Variant = "assignment" | "team_change";

/**
 * Asks before a save that ends driving authorizations (#1425, Organization ADR 0005): who
 * stops being an intended driver and which class authorizations end. `confirm(endings)`
 * resolves true at once when nobody is affected, else when the admin confirms. Render
 * `dialog` once next to the screen that saves.
 */
export function useDrivingLicenceEndingConfirmation(variant: Variant): {
	confirm: (endings: readonly DrivingLicenceEnding[]) => Promise<boolean>;
	dialog: ReactNode;
} {
	const { t } = useTranslate();
	const [endings, setEndings] = useState<readonly DrivingLicenceEnding[] | null>(null);
	const resolver = useRef<((confirmed: boolean) => void) | null>(null);
	const settle = useCallback((confirmed: boolean) => {
		resolver.current?.(confirmed);
		resolver.current = null;
		setEndings(null);
	}, []);
	const confirm = useCallback((next: readonly DrivingLicenceEnding[]) => {
		if (!next.length) return Promise.resolve(true);
		resolver.current?.(false);
		return new Promise<boolean>((resolve) => {
			resolver.current = resolve;
			setEndings(next);
		});
	}, []);
	const dialog = (
		<AlertDialog
			open={endings !== null}
			onOpenChange={(open) => {
				if (!open) settle(false);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{variant === "assignment"
							? t("drivingLicence.ending.assignmentTitle", "End driving authorizations?")
							: t(
									"drivingLicence.ending.teamChangeTitle",
									"This team change ends driving authorizations",
								)}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{variant === "assignment"
							? t(
									"drivingLicence.ending.assignmentDescription",
									"These employees stop being intended drivers when you save. Their driving authorizations end at once and their check records start their retention period. Driving again requires a new check.",
								)
							: t(
									"drivingLicence.ending.teamChangeDescription",
									"These employees stop being intended drivers because their primary team changes. Their driving authorizations end at once and their check records start their retention period. Driving again requires a new check.",
								)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<ul
					aria-label={t("drivingLicence.ending.listLabel", "Driving authorizations that end")}
					className="space-y-1 text-sm"
				>
					{endings?.map((item) => (
						<li key={item.employeeId} className="flex flex-wrap justify-between gap-2">
							<span className="font-medium">{item.name}</span>
							<span className="text-muted-foreground" translate="no">
								{item.classCodes.join(", ")}
							</span>
						</li>
					))}
				</ul>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<Button variant="destructive" onClick={() => settle(true)}>
						{variant === "assignment"
							? t("drivingLicence.ending.assignmentConfirm", "Save and end authorizations")
							: t("drivingLicence.ending.teamChangeConfirm", "Continue and end authorizations")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
	return { confirm, dialog };
}

type Preview =
	| { success: true; data: DrivingLicenceEnding[] }
	| { success: false; error?: string | null };

/**
 * The warning on screens that can change an employee's primary team (#1425):
 * `confirmTeamChange(load)` loads the preview of the change and asks when it ends driving
 * authorizations. A preview that can't be loaded refuses the change with a toast.
 */
export function useDrivingLicenceTeamChangeWarning() {
	const { t } = useTranslate();
	const { confirm, dialog } = useDrivingLicenceEndingConfirmation("team_change");
	const confirmTeamChange = useCallback(
		async (load: () => Promise<Preview>) => {
			let preview: Preview;
			try {
				preview = await load();
			} catch {
				preview = { success: false };
			}
			if (!preview.success) {
				toast.error(
					t(
						"drivingLicence.ending.teamChangePreviewFailed",
						"Couldn't check whether this change ends driving authorizations. Try again.",
					),
				);
				return false;
			}
			return confirm(preview.data);
		},
		[confirm, t],
	);
	return { confirmTeamChange, drivingLicenceWarning: dialog };
}
