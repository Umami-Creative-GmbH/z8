"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	shouldCheckDeploymentVersion,
	shouldReloadForBuildHash,
} from "./deployment-refresh-checker-utils";

export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_THRESHOLD_MS = CHECK_INTERVAL_MS;

type AppVersionResponse = {
	buildHash?: unknown;
};

type DeploymentRefreshCheckerProps = {
	clientBuildHash: string;
};

async function fetchAppVersion() {
	const response = await fetch("/api/app-version", {
		cache: "no-store",
		headers: { accept: "application/json" },
	});

	if (!response.ok) return null;

	return (await response.json()) as AppVersionResponse;
}

export function DeploymentRefreshChecker({ clientBuildHash }: DeploymentRefreshCheckerProps) {
	const lastActivityAtRef = useRef(0);
	const mountedRef = useRef(true);
	const reloadStartedRef = useRef(false);

	useQuery({
		queryKey: ["app-version", clientBuildHash],
		queryFn: async () => {
			if (
				reloadStartedRef.current ||
				!shouldCheckDeploymentVersion({
					idleThresholdMs: IDLE_THRESHOLD_MS,
					isDocumentHidden: document.hidden,
					lastActivityAt: lastActivityAtRef.current,
					now: Date.now(),
				})
			) {
				return null;
			}

			const appVersion = await fetchAppVersion();
			if (!clientBuildHash || !appVersion || !mountedRef.current || reloadStartedRef.current) return appVersion;

			const serverBuildHash =
				typeof appVersion.buildHash === "string" && appVersion.buildHash.length > 0
					? appVersion.buildHash
					: null;

			if (shouldReloadForBuildHash(clientBuildHash, serverBuildHash)) {
				reloadStartedRef.current = true;
				window.location.reload();
			}

			return appVersion;
		},
		enabled: Boolean(clientBuildHash),
		initialData: null,
		initialDataUpdatedAt: () => Date.now(),
		refetchInterval: CHECK_INTERVAL_MS,
		refetchIntervalInBackground: true,
		retry: false,
		staleTime: CHECK_INTERVAL_MS,
	});

	useEffect(() => {
		mountedRef.current = true;
		lastActivityAtRef.current = Date.now();

		const recordActivity = () => {
			lastActivityAtRef.current = Date.now();
		};

		window.addEventListener("focus", recordActivity, { passive: true });
		window.addEventListener("keydown", recordActivity, { passive: true });
		window.addEventListener("mousedown", recordActivity, { passive: true });
		window.addEventListener("pointerdown", recordActivity, { passive: true });
		window.addEventListener("touchstart", recordActivity, { passive: true });
		window.addEventListener("wheel", recordActivity, { passive: true });

		return () => {
			mountedRef.current = false;

			window.removeEventListener("focus", recordActivity);
			window.removeEventListener("keydown", recordActivity);
			window.removeEventListener("mousedown", recordActivity);
			window.removeEventListener("pointerdown", recordActivity);
			window.removeEventListener("touchstart", recordActivity);
			window.removeEventListener("wheel", recordActivity);
		};
	}, []);

	return null;
}
