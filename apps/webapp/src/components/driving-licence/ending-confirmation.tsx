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
import {
	DRIVING_LICENCE_STALE_PREVIEW,
	type DrivingLicenceEnding,
	type DrivingLicenceTeamChangeImpact,
} from "@/lib/organization/driving-licence/intended-driver-rules";

type Variant = "assignment" | "team_change";
/** What the dialog lists: who loses which classes, or (generic) only that some authorizations end. */
type Shown = { kind: "full"; endings: readonly DrivingLicenceEnding[] } | { kind: "generic" };

/**
 * Asks before a save that ends driving authorizations (#1425, Organization ADR 0005): who
 * stops being an intended driver and which class authorizations end. `confirm(endings)`
 * resolves true at once when nobody is affected, else when the admin confirms;
 * `confirmGeneric()` asks without names or classes. Render `dialog` once next to the screen
 * that saves.
 */
export function useDrivingLicenceEndingConfirmation(variant: Variant): {
	confirm: (endings: readonly DrivingLicenceEnding[]) => Promise<boolean>;
	confirmGeneric: () => Promise<boolean>;
	dialog: ReactNode;
} {
	const { t } = useTranslate();
	const [shown, setShown] = useState<Shown | null>(null);
	const resolver = useRef<((confirmed: boolean) => void) | null>(null);
	const settle = useCallback((confirmed: boolean) => {
		resolver.current?.(confirmed);
		resolver.current = null;
		setShown(null);
	}, []);
	const ask = useCallback((next: Shown) => {
		resolver.current?.(false);
		return new Promise<boolean>((resolve) => {
			resolver.current = resolve;
			setShown(next);
		});
	}, []);
	const confirm = useCallback(
		(next: readonly DrivingLicenceEnding[]) =>
			next.length ? ask({ kind: "full", endings: next }) : Promise.resolve(true),
		[ask],
	);
	const confirmGeneric = useCallback(() => ask({ kind: "generic" }), [ask]);
	const dialog = (
		<AlertDialog
			open={shown !== null}
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
						{shown?.kind === "generic"
							? t(
									"drivingLicence.ending.teamChangeGeneric",
									"This change ends driving authorizations for some employees.",
								)
							: variant === "assignment"
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
				{shown?.kind === "full" ? (
					<ul
						aria-label={t("drivingLicence.ending.listLabel", "Driving authorizations that end")}
						className="space-y-1 text-sm"
					>
						{shown.endings.map((item) => (
							<li key={item.employeeId} className="flex flex-wrap justify-between gap-2">
								<span className="font-medium">{item.name}</span>
								<span className="text-muted-foreground" translate="no">
									{item.classCodes.join(", ")}
								</span>
							</li>
						))}
					</ul>
				) : null}
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
	return { confirm, confirmGeneric, dialog };
}

type Preview =
	| { success: true; data: DrivingLicenceTeamChangeImpact }
	| { success: false; error?: string | null };
type SaveRefusal = { error?: string | null; refusal?: string };

/**
 * The warning on screens that can change an employee's primary team (#1425):
 * `confirmTeamChange(load)` loads the preview of the change, asks when it ends driving
 * authorizations, and resolves the token the save takes (null: don't save). A preview that
 * can't be loaded refuses the change with a toast. `teamChangeError(result, fallback)` words
 * a refused save, including a warning that went stale.
 */
export function useDrivingLicenceTeamChangeWarning() {
	const { t } = useTranslate();
	const { confirm, confirmGeneric, dialog } = useDrivingLicenceEndingConfirmation("team_change");
	const confirmTeamChange = useCallback(
		async (load: () => Promise<Preview>): Promise<string | null> => {
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
				return null;
			}
			const impact = preview.data;
			const confirmed =
				impact.detail === "full"
					? await confirm(impact.employees)
					: !impact.affected || (await confirmGeneric());
			return confirmed ? impact.previewToken : null;
		},
		[confirm, confirmGeneric, t],
	);
	const teamChangeError = useCallback(
		(result: SaveRefusal, fallback: string) =>
			result.refusal === DRIVING_LICENCE_STALE_PREVIEW
				? t(
						"drivingLicence.ending.teamChangeStale",
						"Who this change affects has changed in the meantime. Try the change again to review it.",
					)
				: result.error || fallback,
		[t],
	);
	return { confirmTeamChange, teamChangeError, drivingLicenceWarning: dialog };
}
