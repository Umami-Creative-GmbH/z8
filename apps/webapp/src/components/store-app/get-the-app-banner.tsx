"use client";

import { IconDeviceMobile, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useId, useSyncExternalStore } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
import {
	APP_BANNER_DISMISSED_AT_STORAGE_KEY,
	decideAppBanner,
	type StoreAppUrls,
} from "@/lib/store-app/app-banner";
import { isStoreAppShell, type StoreAppPlatform } from "@/lib/store-app/shell";

// Matches the `md` breakpoint used by `useIsMobile` and the sidebar.
const PHONE_WIDTH_QUERY = "(max-width: 767px)";
const STANDALONE_QUERY = "(display-mode: standalone)";

const dismissalListeners = new Set<() => void>();

function matchesMedia(query: string): boolean {
	return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function readDismissedAt(): string | null {
	try {
		return window.localStorage.getItem(APP_BANNER_DISMISSED_AT_STORAGE_KEY);
	} catch {
		return null;
	}
}

function writeDismissedAt(value: string) {
	try {
		window.localStorage.setItem(APP_BANNER_DISMISSED_AT_STORAGE_KEY, value);
	} catch {
		// Storage can be blocked; the banner then stays hidden for this page view only.
	}
}

function subscribe(callback: () => void) {
	const queries =
		typeof window.matchMedia === "function"
			? [window.matchMedia(PHONE_WIDTH_QUERY), window.matchMedia(STANDALONE_QUERY)]
			: [];
	for (const query of queries) query.addEventListener("change", callback);
	window.addEventListener("storage", callback);
	dismissalListeners.add(callback);

	return () => {
		for (const query of queries) query.removeEventListener("change", callback);
		window.removeEventListener("storage", callback);
		dismissalListeners.delete(callback);
	};
}

function getServerPlatform(): StoreAppPlatform | null {
	return null;
}

interface GetTheAppBannerProps {
	storeUrls: StoreAppUrls;
}

/**
 * Suggests the Z8 store app to signed-in phone browsers (#847). Renders nothing until the
 * store listings are configured, and floats over the page so it never shifts the layout.
 */
export function GetTheAppBanner({ storeUrls }: GetTheAppBannerProps) {
	if (!storeUrls.ios && !storeUrls.android) return null;

	return <GetTheAppBannerContent storeUrls={storeUrls} />;
}

function GetTheAppBannerContent({ storeUrls }: GetTheAppBannerProps) {
	const { t } = useTranslate();
	const titleId = useId();
	const descriptionId = useId();
	const { ios, android } = storeUrls;

	const getPlatform = useCallback(
		() =>
			decideAppBanner({
				userAgent: navigator.userAgent ?? "",
				isPhoneWidth: matchesMedia(PHONE_WIDTH_QUERY),
				isStandalone:
					matchesMedia(STANDALONE_QUERY) ||
					(navigator as Navigator & { standalone?: boolean }).standalone === true,
				isStoreAppShell: isStoreAppShell(),
				dismissedAt: readDismissedAt(),
				now: Temporal.Now.instant(),
				storeUrls: { ios, android },
			})?.platform ?? null,
		[ios, android],
	);
	const platform = useSyncExternalStore(subscribe, getPlatform, getServerPlatform);
	const storeUrl = platform ? storeUrls[platform] : null;

	if (!storeUrl) return null;

	const dismiss = () => {
		writeDismissedAt(Temporal.Now.instant().toString());
		for (const listener of dismissalListeners) listener();
	};

	return (
		<aside
			aria-labelledby={titleId}
			className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgb(0_0_0/0.08)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
		>
			<div className="flex items-center gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<IconDeviceMobile className="size-5" aria-hidden="true" />
				</div>
				<div className="min-w-0 flex-1">
					<p id={titleId} className="text-sm font-medium leading-tight">
						{t("common:storeAppBanner.title", "Z8 for your phone")}
					</p>
					<p id={descriptionId} className="text-xs leading-snug text-muted-foreground">
						{t(
							"common:storeAppBanner.description",
							"Get reminders and approval notifications in the app.",
						)}
					</p>
				</div>
				<Button asChild size="sm" className="h-11 shrink-0 px-3">
					<a
						href={storeUrl}
						target="_blank"
						rel="noopener noreferrer"
						aria-describedby={descriptionId}
					>
						{t("common:storeAppBanner.getApp", "Get the app")}
					</a>
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="-mr-1 size-11 shrink-0 text-muted-foreground"
					onClick={dismiss}
					aria-label={t("common:storeAppBanner.dismiss", "Dismiss app suggestion")}
				>
					<IconX className="size-5" aria-hidden="true" />
				</Button>
			</div>
		</aside>
	);
}
