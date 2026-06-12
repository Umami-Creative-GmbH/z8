"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	shouldCheckDeploymentVersion,
	shouldReloadForBuildHash,
} from "./deployment-refresh-checker-utils";

export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_THRESHOLD_MS = CHECK_INTERVAL_MS;
const ACTIVITY_EVENTS = ["focus", "keydown", "mousedown", "pointerdown", "touchstart", "wheel"];

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

		for (const eventName of ACTIVITY_EVENTS) {
			window.addEventListener(eventName, recordActivity, { passive: true });
		}

		return () => {
			mountedRef.current = false;

			for (const eventName of ACTIVITY_EVENTS) {
				window.removeEventListener(eventName, recordActivity);
			}
		};
	}, []);

	return null;
}
