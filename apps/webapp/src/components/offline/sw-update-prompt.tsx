"use client";

import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Prompts the user when a new service worker version is available
 *
 * Shows a toast notification with options to update now or dismiss.
 * On update, sends SKIP_WAITING message to SW and reloads the page.
 */
export function SWUpdatePrompt() {
	const { t } = useTranslate();
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
	const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

	// Store t in ref to avoid effect dependency (rerender-dependencies)
	const tRef = useRef(t);
	useEffect(() => {
		tRef.current = t;
	}, [t]);

	useEffect(() => {
		registrationRef.current = registration;
	}, [registration]);

	// Listen for SW updates
	useEffect(() => {
		if (!("serviceWorker" in navigator)) {
			return;
		}

		let mounted = true;

		const checkForUpdates = async () => {
			try {
				const reg = await navigator.serviceWorker.ready;

				if (!mounted) return;

				setRegistration(reg);

				// Check if there's already a waiting worker
				if (reg.waiting) {
					setUpdateAvailable(true);
				}

				// Listen for new service workers
				reg.addEventListener("updatefound", () => {
					const newWorker = reg.installing;

					if (!newWorker) return;

					newWorker.addEventListener("statechange", () => {
						if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
							// New SW installed, waiting to activate
							if (mounted) {
								setUpdateAvailable(true);
							}
						}
					});
				});
			} catch (error) {
				console.warn("[SWUpdate] Failed to check for updates:", error);
			}
		};

		checkForUpdates();

		// Also listen for controllerchange (SW took over)
		const handleControllerChange = () => {
			// Reload after SW takes over
			window.location.reload();
		};

		navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

		// Listen for SW messages about updates
		const handleMessage = (event: MessageEvent) => {
			if (event.data?.type === "SW_UPDATE_AVAILABLE") {
				setUpdateAvailable(true);
			}
		};

		navigator.serviceWorker.addEventListener("message", handleMessage);

		return () => {
			mounted = false;
			navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
			navigator.serviceWorker.removeEventListener("message", handleMessage);
		};
	}, []);

	// Show toast when update is available
	useEffect(() => {
		if (!updateAvailable) return;

		// Use ref to get current t without triggering effect on t changes
		const t = tRef.current;
		const toastId = toast(t("common.sw.update.title", "Update available"), {
			description: t("common.sw.update.description", "A new version is ready. Reload to update."),
			duration: Infinity, // Don't auto-dismiss
			action: {
				label: t("common.sw.update.reload", "Reload"),
				onClick: () => {
					const currentRegistration = registrationRef.current;
					if (!currentRegistration?.waiting) {
						window.location.reload();
						return;
					}

					currentRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
				},
			},
			cancel: {
				label: t("common.sw.update.later", "Later"),
				onClick: () => {
					// Just dismiss the toast
				},
			},
		});

		return () => {
			toast.dismiss(toastId);
		};
	}, [updateAvailable]);

	// This component doesn't render anything visible
	// It uses toasts for UI
	return null;
}
