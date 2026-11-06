"use client";

import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";

function useRouteRefresh() {
	const router = useRouter();
	const [refreshing, startTransition] = useTransition();
	return {
		refreshing,
		refresh: () => startTransition(() => router.refresh()),
	};
}

/** Reloads the equipment setup and officer grants from the server. */
export function EquipmentRefreshButton() {
	const { t } = useTranslate();
	const { refreshing, refresh } = useRouteRefresh();
	const label = t("settings.equipment.reload", "Reload setup");
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={label}
			title={label}
			disabled={refreshing}
			onClick={refresh}
		>
			<IconRefresh
				className={cn("size-4", refreshing && "motion-safe:animate-spin")}
				aria-hidden="true"
			/>
		</Button>
	);
}

/** A section of the equipment settings that could not be read, with a retry. */
export function EquipmentLoadError({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	const { t } = useTranslate();
	const { refreshing, refresh } = useRouteRefresh();
	return (
		<Alert variant="destructive">
			<IconAlertTriangle aria-hidden="true" />
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription className="gap-3">
				<p>{description}</p>
				<Button
					variant="outline"
					size="sm"
					onClick={refresh}
					disabled={refreshing}
				>
					<IconRefresh
						className={cn("size-4", refreshing && "motion-safe:animate-spin")}
						aria-hidden="true"
					/>
					{t("common.retry", "Retry")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}
