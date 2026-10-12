"use client";

import { IconBan } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";

/** Shown while the device's token belongs to a revoked kiosk. */
export function KioskRevokedScreen({ onPairAgain }: { onPairAgain: () => void }) {
	const { t } = useTranslate();
	return (
		<div className="m-auto flex max-w-md flex-col items-center gap-6 text-center" role="alert">
			<IconBan className="size-14 text-destructive" aria-hidden="true" />
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold">
					{t("timeTracking.kiosk.revoked.title", "Kiosk revoked")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"timeTracking.kiosk.revoked.description",
						"This kiosk can no longer be used for clocking. Please contact your admin.",
					)}
				</p>
			</div>
			<Button variant="outline" size="lg" className="h-14" onClick={onPairAgain}>
				{t("timeTracking.kiosk.revoked.pairAgain", "Pair with a new code")}
			</Button>
		</div>
	);
}
