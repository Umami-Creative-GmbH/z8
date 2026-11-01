"use client";

import { IconNfc, IconRefresh } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import {
	getOwnKioskFobStatusAction,
	removeOwnKioskFobAction,
} from "@/app/[locale]/(app)/settings/security/kiosk-fob-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KioskFobManagementRefusal } from "@/lib/time-tracking/kiosk/fob-errors";
import { KioskFobRemoveControls } from "./kiosk-fob-remove-controls";
import { kioskFobDetails, kioskFobErrorMessage } from "./kiosk-fob-text";

const OWN_FOB_STATUS_KEY = ["kiosk", "own-fob-status"] as const;

/**
 * The signed-in employee's own kiosk fob (#1508), next to their kiosk PIN on the
 * security page: when and where it was registered, its last four characters,
 * and removing it, for example after losing it. Registration happens at a
 * kiosk. Shown only to employees of the active organization, and without a fob
 * only where a kiosk reads fobs; a status that could not be read says so.
 */
export function OwnKioskFobCard() {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const queryClient = useQueryClient();
	const statusQuery = useQuery({
		queryKey: OWN_FOB_STATUS_KEY,
		queryFn: async () => {
			const result = await getOwnKioskFobStatusAction();
			if (!result.success) throw new KioskFobManagementRefusal(result.code, result.error);
			return result.data;
		},
	});
	const status = statusQuery.data;
	const refresh = () => queryClient.invalidateQueries({ queryKey: OWN_FOB_STATUS_KEY });

	const failed = statusQuery.isError && !status;
	if (!failed && (!status || (!status.fob && !status.fobReaderInUse))) return null;
	const fob = status?.fob ?? null;

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
				{failed || !status ? (
					<div className="flex flex-col items-start gap-3">
						<p className="text-sm" role="alert">
							{kioskFobErrorMessage(
								t,
								statusQuery.error instanceof KioskFobManagementRefusal
									? statusQuery.error.code
									: "failed",
							)}
						</p>
						<Button variant="outline" onClick={() => void statusQuery.refetch()}>
							<IconRefresh className="mr-2 size-4" aria-hidden="true" />
							{t("common.retry", "Retry")}
						</Button>
					</div>
				) : (
					<>
						<p className="text-sm" aria-live="polite">
							{fob
								? kioskFobDetails(t, fob, status.timezone, locale)
								: t(
										"settings.security.kioskFob.none",
										"No fob registered. To register one, tap it on a kiosk's fob reader and confirm with your kiosk PIN.",
									)}
						</p>
						{fob && (
							<KioskFobRemoveControls
								remove={() => removeOwnKioskFobAction(fob.fobId)}
								confirmText={t(
									"settings.security.kioskFob.confirmRemoveText",
									"If you lost it, remove it: it stops working at kiosks at once. Your kiosk PIN keeps working.",
								)}
								onRefresh={refresh}
								t={t}
							/>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}
