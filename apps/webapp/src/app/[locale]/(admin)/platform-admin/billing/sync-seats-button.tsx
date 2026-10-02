"use client";

import { IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncOrganizationSeatsAction } from "./actions";

interface SyncSeatsButtonProps {
	organizationId: string;
	organizationName: string;
}

export function SyncSeatsButton({
	organizationId,
	organizationName,
}: SyncSeatsButtonProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={isPending}
			aria-label={t(
				"admin.billing.syncSeatsFor",
				"Sync seats for {organizationName}",
				{ organizationName },
			)}
			onClick={() => {
				startTransition(async () => {
					try {
						const result = await syncOrganizationSeatsAction(organizationId);

						if (result.success) {
							toast.success(t("admin.billing.seatsSynced", "Seats synced"));
							router.refresh();
							return;
						}

						toast.error(
							result.error ||
								t("admin.billing.failedToSyncSeats", "Failed to sync seats"),
						);
					} catch {
						toast.error(
							t("admin.billing.failedToSyncSeats", "Failed to sync seats"),
						);
					}
				});
			}}
		>
			<IconRefresh
				className={`size-4 ${isPending ? "animate-spin" : ""}`}
				aria-hidden="true"
			/>
			<span className="sr-only">
				{t("admin.billing.syncSeatsFor", "Sync seats for {organizationName}", {
					organizationName,
				})}
			</span>
		</Button>
	);
}
