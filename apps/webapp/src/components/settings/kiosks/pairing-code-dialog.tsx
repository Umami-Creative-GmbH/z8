"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import type { IssuedPairingCodeData } from "@/app/[locale]/(app)/settings/kiosks/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { kioskPairingUrl } from "./kiosk-format";

interface PairingCodeDialogProps {
	issued: IssuedPairingCodeData | null;
	kioskName: string;
	onClose: () => void;
}

/**
 * Shows a freshly issued pairing code once: as text, and as a QR code that
 * opens the kiosk page with the code filled in.
 */
export function PairingCodeDialog({ issued, kioskName, onClose }: PairingCodeDialogProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const url =
		issued && typeof window !== "undefined"
			? kioskPairingUrl(window.location.origin, locale, issued.pairingCode)
			: "";

	return (
		<Dialog
			open={issued !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{t("settings.kiosks.pairingTitle", "Pair {name}", { name: kioskName })}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.kiosks.pairingDescription",
							"On the kiosk device, scan the QR code or open the kiosk page and enter the code. The code works once and expires after 10 minutes.",
						)}
					</DialogDescription>
				</DialogHeader>
				{issued ? (
					<div className="flex flex-col items-center gap-4 py-2">
						<div className="text-center">
							<p className="text-sm text-muted-foreground">
								{t("settings.kiosks.pairingCodeLabel", "Pairing code")}
							</p>
							<p className="font-mono text-3xl font-semibold tracking-widest">
								{issued.pairingCode}
							</p>
						</div>
						<div className="rounded-lg bg-white p-3">
							<QRCodeSVG value={url} size={192} aria-hidden="true" />
						</div>
						<p
							className="break-all text-center text-xs text-muted-foreground"
							data-testid="kiosk-pairing-url"
						>
							{url}
						</p>
					</div>
				) : null}
				<DialogFooter>
					<Button onClick={onClose}>{t("settings.kiosks.pairingDone", "Done")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
