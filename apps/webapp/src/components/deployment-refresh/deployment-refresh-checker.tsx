"use client";

import { useEffect, useRef } from "react";

export const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_THRESHOLD_MS = CHECK_INTERVAL_MS;
const ACTIVITY_EVENTS = ["focus", "keydown", "mousedown", "pointerdown", "touchstart", "wheel"];

type CheckDecisionInput = {
	idleThresholdMs: number;
	isDocumentHidden: boolean;
	lastActivityAt: number;
	now: number;
};

type AppVersionResponse = {
	buildHash?: unknown;
};

type DeploymentRefreshCheckerProps = {
	clientBuildHash: string;
};

export function shouldCheckDeploymentVersion({
	idleThresholdMs,
	isDocumentHidden,
	lastActivityAt,
	now,
}: CheckDecisionInput) {
	return isDocumentHidden || now - lastActivityAt >= idleThresholdMs;
}

export function shouldReloadForBuildHash(clientBuildHash: string, serverBuildHash: string | null) {
	return Boolean(clientBuildHash && serverBuildHash && clientBuildHash !== serverBuildHash);
}

export function DeploymentRefreshChecker({ clientBuildHash }: DeploymentRefreshCheckerProps) {
	const lastActivityAtRef = useRef(Date.now());
	const mountedRef = useRef(false);
	const requestInFlightRef = useRef(false);
	const reloadStartedRef = useRef(false);

	useEffect(() => {
		mountedRef.current = true;

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

	useEffect(() => {
		if (!clientBuildHash) return;

		const checkForNewDeployment = async () => {
			if (reloadStartedRef.current || requestInFlightRef.current) return;

			if (
				!shouldCheckDeploymentVersion({
					idleThresholdMs: IDLE_THRESHOLD_MS,
					isDocumentHidden: document.hidden,
					lastActivityAt: lastActivityAtRef.current,
					now: Date.now(),
				})
			) {
				return;
			}

			requestInFlightRef.current = true;

			try {
				const response = await fetch("/api/app-version", {
					cache: "no-store",
					headers: { accept: "application/json" },
				});

				if (!mountedRef.current || reloadStartedRef.current) return;
				if (!response.ok) return;

				const payload = (await response.json()) as AppVersionResponse;

				if (!mountedRef.current || reloadStartedRef.current) return;

				const serverBuildHash =
					typeof payload.buildHash === "string" && payload.buildHash.length > 0
						? payload.buildHash
						: null;

				if (!shouldReloadForBuildHash(clientBuildHash, serverBuildHash)) return;

				reloadStartedRef.current = true;
				window.location.reload();
			} catch {
				// Version checks are best-effort; the next interval can try again.
			} finally {
				requestInFlightRef.current = false;
			}
		};

		const intervalId = window.setInterval(checkForNewDeployment, CHECK_INTERVAL_MS);

		return () => window.clearInterval(intervalId);
	}, [clientBuildHash]);

	return null;
}
