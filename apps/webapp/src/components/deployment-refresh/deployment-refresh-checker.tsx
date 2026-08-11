"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent } from "react";
import { toast } from "sonner";
import {
	shouldCheckDeploymentVersion,
	shouldPromptForBuildHash,
} from "./deployment-refresh-checker-utils";

export const CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const APP_VERSION_QUERY_KEY = ["app-version"] as const;

type AppVersionResponse = {
	buildHash?: unknown;
};

type DeploymentRefreshCheckerProps = {
	clientBuildHash: string;
};

async function fetchAppVersion(
	signal: AbortSignal,
): Promise<AppVersionResponse | null> {
	try {
		const response = await fetch("/api/app-version", {
			cache: "no-store",
			headers: { accept: "application/json" },
			signal,
		});
		if (!response.ok) return null;

		return (await response.json()) as AppVersionResponse;
	} catch {
		return null;
	}
}

export function DeploymentRefreshChecker({
	clientBuildHash,
}: DeploymentRefreshCheckerProps) {
	const { t } = useTranslate();
	const { refetch: refetchAppVersion } = useQuery({
		queryKey: APP_VERSION_QUERY_KEY,
		queryFn: ({ signal }) => fetchAppVersion(signal),
		enabled: false,
		retry: false,
		staleTime: 0,
	});
	const getCurrentClientBuildHash = useEffectEvent(() => clientBuildHash);
	const getCurrentTranslator = useEffectEvent(() => t);
	const getCurrentAppVersion = useEffectEvent(async () => {
		const { data } = await refetchAppVersion({ cancelRefetch: false });
		return data ?? null;
	});

	useEffect(() => {
		let mounted = true;
		let promptShown = false;
		let toastId: string | number | undefined;
		let lastCheckStartedAt = Date.now();

		const checkDeploymentVersion = async () => {
			const now = Date.now();
			const currentClientBuildHash = getCurrentClientBuildHash();
			if (
				!currentClientBuildHash ||
				promptShown ||
				!shouldCheckDeploymentVersion({
					checkCooldownMs: CHECK_COOLDOWN_MS,
					isDocumentHidden: document.hidden,
					lastCheckStartedAt,
					now,
				})
			) {
				return;
			}

			lastCheckStartedAt = now;
			const appVersion = await getCurrentAppVersion();
			if (!appVersion || !mounted || promptShown) return;

			const latestClientBuildHash = getCurrentClientBuildHash();
			const serverBuildHash =
				typeof appVersion.buildHash === "string" &&
				appVersion.buildHash.length > 0
					? appVersion.buildHash
					: null;
			if (!shouldPromptForBuildHash(latestClientBuildHash, serverBuildHash))
				return;

			promptShown = true;
			const currentT = getCurrentTranslator();
			toastId = toast(currentT("common.sw.update.title", "Update available"), {
				description: currentT(
					"common.sw.update.description",
					"A new version is ready. Reload to update.",
				),
				duration: Infinity,
				action: {
					label: currentT("common.sw.update.reload", "Reload"),
					onClick: () => window.location.reload(),
				},
				cancel: {
					label: currentT("common.sw.update.later", "Later"),
					onClick: () => {},
				},
			});
		};

		const handleForegroundEvent = () => {
			void checkDeploymentVersion();
		};

		document.addEventListener("visibilitychange", handleForegroundEvent);
		window.addEventListener("focus", handleForegroundEvent);

		return () => {
			mounted = false;
			document.removeEventListener("visibilitychange", handleForegroundEvent);
			window.removeEventListener("focus", handleForegroundEvent);
			if (toastId !== undefined) toast.dismiss(toastId);
		};
	}, []);

	return null;
}
