"use client";

import { IconLoader2, IconNfc, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getOwnKioskFobStatusAction,
	removeOwnKioskFobAction,
} from "@/app/[locale]/(app)/settings/security/kiosk-fob-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { kioskFobDetails, kioskFobErrorMessage } from "./kiosk-fob-text";

const OWN_FOB_STATUS_KEY = ["kiosk", "own-fob-status"] as const;
const SPINNER = "mr-2 size-4 animate-spin motion-reduce:animate-none";

/**
 * The signed-in employee's own kiosk fob (#1508), next to their kiosk PIN on the
 * security page: when and where it was registered, its last 4 hex digits, and
 * removing it, for example after losing it. Registration happens at a kiosk.
 * Shown only to employees of the active organization, and without a fob only
 * where a kiosk reads fobs.
 */
export function OwnKioskFobCard() {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const statusQuery = useQuery({
		queryKey: OWN_FOB_STATUS_KEY,
		queryFn: async () => {
			const result = await getOwnKioskFobStatusAction();
			return result.success ? result.data : null;
		},
	});
	const status = statusQuery.data;
	// Removal names the fob this card shows, so a change made meanwhile is refused.
	const shownFobId = status?.fob?.fobId ?? "";
	const removeMutation = useMutation({
		mutationFn: () => removeOwnKioskFobAction(shownFobId),
		onSuccess: (result) => {
			setConfirming(false);
			if (!result.success) {
				toast.error(kioskFobErrorMessage(t, result.code));
				if (result.code === "fob_changed") {
					void queryClient.invalidateQueries({ queryKey: OWN_FOB_STATUS_KEY });
				}
				return;
			}
			toast.success(t("settings.kioskFob.removed", "Kiosk fob removed"));
			void queryClient.invalidateQueries({ queryKey: OWN_FOB_STATUS_KEY });
		},
		onError: () => toast.error(kioskFobErrorMessage(t, "failed")),
	});

	if (!status || (!status.fob && !status.fobReaderInUse)) return null;
	const busy = removeMutation.isPending;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconNfc className="size-5" aria-hidden="true" />
					{t("settings.security.kioskFob.title", "Kiosk fob")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.security.kioskFob.description",
						"An NFC card or fob you tap at a kiosk to pick your name. Your kiosk PIN still proves it is you.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<p className="text-sm" aria-live="polite">
					{status.fob
						? kioskFobDetails(t, status.fob, status.timezone, locale)
						: t(
								"settings.security.kioskFob.none",
								"No fob registered. To register one, tap it on a kiosk's fob reader and confirm with your kiosk PIN.",
							)}
				</p>
				{status.fob && confirming && (
					<p className="text-sm text-muted-foreground" role="alert">
						{t(
							"settings.security.kioskFob.confirmRemoveText",
							"If you lost it, remove it: it stops working at kiosks at once. Your kiosk PIN keeps working.",
						)}
					</p>
				)}
				{status.fob && (
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
						{confirming ? (
							<>
								<Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button
									variant="destructive"
									onClick={() => removeMutation.mutate()}
									disabled={busy}
								>
									{busy && <IconLoader2 className={SPINNER} aria-hidden="true" />}
									{t("settings.kioskFob.confirmRemove", "Remove the fob")}
								</Button>
							</>
						) : (
							<Button variant="outline" onClick={() => setConfirming(true)} disabled={busy}>
								<IconTrash className="mr-2 size-4" aria-hidden="true" />
								{t("settings.kioskFob.remove", "Remove fob")}
							</Button>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
