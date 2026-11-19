"use client";

import { IconAlertCircle, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type SettingsLoadErrorProps = {
	/** What failed to load, already translated. */
	message: string;
	/** Refetches the failed data. Defaults to refreshing the route's server data. */
	onRetry?: () => void;
	isRetrying?: boolean;
	/** Overrides the default "Retry" label, already translated. */
	retryLabel?: string;
};

/**
 * A settings page or section whose data could not be loaded: says what failed
 * and offers a retry without leaving the page. Pass `onRetry` to refetch client
 * data; without it, Retry re-requests the route's server data (router.refresh),
 * so server-rendered pages recover without a full reload. Never render defaults
 * in place of failed data: a save would write over the real settings.
 */
export function SettingsLoadError({ onRetry, ...props }: SettingsLoadErrorProps) {
	return onRetry ? (
		<LoadErrorAlert {...props} onRetry={onRetry} />
	) : (
		<RouteRefreshLoadError {...props} />
	);
}

function RouteRefreshLoadError({
	isRetrying = false,
	...props
}: Omit<SettingsLoadErrorProps, "onRetry">) {
	const router = useRouter();
	const [isRefreshing, startTransition] = useTransition();
	return (
		<LoadErrorAlert
			{...props}
			isRetrying={isRetrying || isRefreshing}
			onRetry={() => startTransition(() => router.refresh())}
		/>
	);
}

function LoadErrorAlert({
	message,
	onRetry,
	isRetrying = false,
	retryLabel,
}: SettingsLoadErrorProps & { onRetry: () => void }) {
	const { t } = useTranslate();
	return (
		// The row is as tall as the sm button (32px): the message is padded to that
		// height and the icon is centred on it, so the icon stays level with the
		// first line of text whether or not the button wraps below it.
		<Alert variant="destructive" className="[&>svg]:translate-y-2">
			<IconAlertCircle aria-hidden="true" />
			<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
				<span className="min-w-0 py-1.5">{message}</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={isRetrying}
					aria-busy={isRetrying}
					onClick={onRetry}
				>
					{isRetrying ? (
						<IconLoader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
					) : (
						<IconRefresh aria-hidden="true" className="size-4" />
					)}
					{retryLabel ?? t("common.retry", "Retry")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}
