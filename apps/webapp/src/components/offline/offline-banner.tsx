"use client";

import { IconCloudOff, IconRefresh, IconWifi } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { useOfflineClock } from "@/hooks/use-offline-clock";
import { cn } from "@/lib/utils";
import { OfflineRecoveryDialog } from "./offline-recovery-dialog";

interface OfflineBannerProps {
	className?: string;
}

type BannerState =
	| "hidden"
	| "offline"
	| "offline_pending"
	| "syncing"
	| "pending"
	| "error";

/**
 * Banner that shows when the user is offline or has pending sync events
 *
 * Displays:
 * - Offline status with pending event count
 * - Syncing status
 * - Sync errors (conflicts)
 */
export function OfflineBanner({ className }: OfflineBannerProps) {
	const { t } = useTranslate();
	const {
		isOffline,
		pendingCount,
		savedCount,
		countVerified,
		isSyncing,
		lastError,
		triggerSync,
		isOnline,
		readRecoveryRecords,
		archiveRecoveryRecord,
		contextKey,
	} = useOfflineClock();

	// Compute banner state once
	const state: BannerState = (() => {
		if (lastError) return "error";
		if (isOffline && pendingCount > 0) return "offline_pending";
		if (isOffline) return "offline";
		if (isSyncing) return "syncing";
		if (savedCount > 0) return "pending";
		return "hidden";
	})();

	const isVisible = state !== "hidden";

	// Style mapping based on state
	const stateStyles: Record<BannerState, string> = {
		hidden: "",
		offline: "bg-amber-500 text-amber-950",
		offline_pending: "bg-amber-500 text-amber-950",
		syncing: "bg-blue-500 text-white",
		pending: "bg-amber-500 text-amber-950",
		error: "bg-red-500 text-white",
	};

	// Icon based on state (hoisted JSX mapping for rendering-hoist-jsx)
	// Icons are decorative (text provides meaning) so use aria-hidden
	const stateIcons: Record<BannerState, React.ReactNode> = {
		hidden: null,
		offline: <IconCloudOff className="size-5" aria-hidden="true" />,
		offline_pending: <IconCloudOff className="size-5" aria-hidden="true" />,
		syncing: (
			<IconRefresh
				className="size-5 animate-spin motion-reduce:animate-none"
				aria-hidden="true"
			/>
		),
		pending: <IconWifi className="size-5" aria-hidden="true" />,
		error: <IconWifi className="size-5" aria-hidden="true" />,
	};

	// Message mapping based on state
	const getMessage = () => {
		switch (state) {
			case "offline":
				return t("common:offline.banner.offline", "You're offline");
			case "offline_pending":
				if (!countVerified)
					return t(
						"common:offline.banner.unverified",
						"Clock evidence saved on this device. Connect to review all saved records.",
					);
				return t(
					"common:offline.banner.offlineSaved",
					"Offline — {count} record(s) saved locally for review",
					{
						count: pendingCount,
					},
				);
			case "syncing":
				return t(
					"common:offline.banner.refreshing",
					"Checking {count} saved record(s)…",
					{
						count: pendingCount,
					},
				);
			case "pending":
				if (pendingCount === 0)
					return t(
						"common:offline.banner.archived",
						"Archived clock evidence retained on this device",
					);
				return t(
					"common:offline.banner.reviewRequired",
					"{count} record(s) saved locally — review required",
					{
						count: pendingCount,
					},
				);
			case "error":
				return lastError;
			default:
				return "";
		}
	};

	// Show retry button when online with pending events or error
	const showRetryButton = isOnline && Boolean(lastError) && !isSyncing;

	return (
		<div
			className={cn(
				"fixed top-0 left-0 right-0 z-50 px-4 py-2 transition-transform duration-300 ease-out motion-reduce:transition-none",
				isVisible ? "translate-y-0" : "-translate-y-full",
				stateStyles[state],
				className,
			)}
			role="alert"
			aria-live="polite"
			inert={!isVisible}
		>
			<div className="container mx-auto flex flex-wrap items-center justify-between gap-4">
				<div className="flex min-w-0 items-center gap-2">
					{stateIcons[state]}
					<span className="break-words text-sm font-medium">
						{getMessage()}
					</span>
				</div>
				{isOnline && (savedCount > 0 || lastError) ? (
					<OfflineRecoveryDialog
						key={contextKey}
						loadRecords={readRecoveryRecords}
						archiveRecord={archiveRecoveryRecord}
					/>
				) : null}

				{showRetryButton && (
					<Button
						size="sm"
						variant="secondary"
						className="h-7 px-2 text-xs bg-white/20 hover:bg-white/30 text-inherit"
						onClick={() => triggerSync()}
					>
						<IconRefresh className="size-4 mr-1" aria-hidden="true" />
						{t("common:offline.banner.refresh", "Refresh status")}
					</Button>
				)}
			</div>
		</div>
	);
}
