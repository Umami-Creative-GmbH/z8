"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { PushPermissionModal } from "./push-permission-modal";

const COOKIE_NAME = "z8_push_dismissed";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
const SHOW_DELAY_MS = 2000; // 2 seconds delay before showing modal

/**
 * Check if the push permission modal has been dismissed
 */
function isDismissed(): boolean {
	if (typeof document === "undefined") return true;
	return document.cookie.includes(`${COOKIE_NAME}=true`);
}

/**
 * Set the dismissed cookie
 */
function setDismissedCookie(): void {
	if (typeof document === "undefined") return;
	document.cookie = `${COOKIE_NAME}=true; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

interface PushPermissionProviderProps {
	children: React.ReactNode;
}

/**
 * Provider component that shows a push notification permission modal
 * on app load if:
 * - Push notifications are supported
 * - Permission has not been asked yet (is "default")
 * - User has not dismissed the modal before
 */
	export function PushPermissionProvider({ children }: PushPermissionProviderProps) {
	const [showModal, setShowModal] = useState(false);
	const hasCheckedRef = useRef(false);

	const {
		isSupported,
		permission,
		isLoading: isPushLoading,
		subscribe,
	} = usePushNotifications({
		onSubscribe: () => {
			toast.success("Push notifications enabled", {
				description: "You will now receive browser push notifications",
			});
		},
		onError: (error) => {
			toast.error("Could not enable push notifications", {
				description: error.message,
			});
		},
	});

	// Check if we should show the modal after component mounts
	useEffect(() => {
		// Wait for push status to load
		if (isPushLoading) return;

		// Only check once
		if (hasCheckedRef.current) return;
		hasCheckedRef.current = true;

		// Don't show if:
		// - Not supported
		// - Already asked (granted or denied)
		// - Previously dismissed
		if (!isSupported || permission !== "default" || isDismissed()) {
			return;
		}

		// Show modal after a short delay to not interrupt initial page load
		const timer = setTimeout(() => {
			setShowModal(true);
		}, SHOW_DELAY_MS);

		return () => clearTimeout(timer);
	}, [isSupported, permission, isPushLoading]);

	const handleEnable = async (): Promise<boolean> => {
		const success = await subscribe();
		if (success) {
			// Don't set dismissed cookie on success - we want to remember they enabled it
			setShowModal(false);
		}
		return success;
	};

	const handleDismiss = () => {
		setDismissedCookie();
		setShowModal(false);
	};

	return (
		<>
			{children}
			<PushPermissionModal
				open={showModal}
				onOpenChange={setShowModal}
				onEnable={handleEnable}
				onDismiss={handleDismiss}
				isLoading={isPushLoading}
			/>
		</>
	);
}
