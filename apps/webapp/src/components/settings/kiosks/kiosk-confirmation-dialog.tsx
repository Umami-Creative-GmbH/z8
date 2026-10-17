"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { KioskData } from "@/app/[locale]/(app)/settings/kiosks/actions";
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

/** A kiosk action waiting for the admin's confirmation: issuing a new pairing code, or revoking. */
export type KioskConfirmation = {
	kind: "pair" | "revoke";
	kiosk: KioskData;
} | null;

/** Confirms pairing a kiosk again (rotating a paired kiosk's token) or revoking it (#859). */
export function KioskConfirmationDialog({
	confirmation,
	pending,
	organizationAdopted,
	onDismiss,
	onConfirm,
}: {
	confirmation: KioskConfirmation;
	pending: boolean;
	organizationAdopted: boolean;
	onDismiss: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();

	return (
		<AlertDialog
			open={confirmation !== null}
			onOpenChange={(open) => {
				if (!open && !pending) onDismiss();
			}}
		>
			<AlertDialogContent>
				{confirmation?.kind === "revoke" ? (
					<RevokeHeader kioskName={confirmation.kiosk.name} />
				) : (
					<PairHeader kiosk={confirmation?.kiosk} organizationAdopted={organizationAdopted} />
				)}
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction
						disabled={pending}
						onClick={(event) => {
							event.preventDefault();
							onConfirm();
						}}
					>
						<ConfirmLabel confirmation={confirmation} />
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function RevokeHeader({ kioskName }: { kioskName: string }) {
	const { t } = useTranslate();
	return (
		<AlertDialogHeader>
			<AlertDialogTitle>
				{t("settings.kiosks.revokeTitle", "Revoke {name}?", {
					name: kioskName,
				})}
			</AlertDialogTitle>
			<AlertDialogDescription>
				{t(
					"settings.kiosks.revokeDescription",
					"The kiosk stops working on its next request and cannot be paired again. Create a new kiosk to replace it.",
				)}
			</AlertDialogDescription>
		</AlertDialogHeader>
	);
}

function PairHeader({
	kiosk,
	organizationAdopted,
}: {
	kiosk: KioskData | undefined;
	organizationAdopted: boolean;
}) {
	const { t } = useTranslate();
	const paired = kiosk?.status === "paired";
	return (
		<AlertDialogHeader>
			<AlertDialogTitle>
				{t("settings.kiosks.pairTitle", "Pair {name} again?", {
					name: kiosk?.name ?? "",
				})}
			</AlertDialogTitle>
			<AlertDialogDescription>
				{paired
					? t(
							"settings.kiosks.pairPairedDescription",
							"The device token is rotated: the paired device stops working immediately and must be paired again with the new code.",
						)
					: t(
							"settings.kiosks.pairUnpairedDescription",
							"A new pairing code replaces the previous one.",
						)}
			</AlertDialogDescription>
			{paired && kiosk.offlineModeEnabled && organizationAdopted ? (
				<p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
					<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					{t(
						"settings.kiosks.rotateOfflineWarning",
						"This kiosk has offline mode on. Clockings it saved while offline and not yet sent are refused when it reconnects, and listed under refused offline clockings.",
					)}
				</p>
			) : null}
		</AlertDialogHeader>
	);
}

function ConfirmLabel({ confirmation }: { confirmation: KioskConfirmation }) {
	const { t } = useTranslate();
	if (confirmation?.kind === "revoke") return t("settings.kiosks.revokeConfirm", "Revoke kiosk");
	return confirmation?.kiosk.status === "paired"
		? t("settings.kiosks.rotateConfirm", "Rotate token and pair again")
		: t("settings.kiosks.issueCodeConfirm", "Issue new code");
}
