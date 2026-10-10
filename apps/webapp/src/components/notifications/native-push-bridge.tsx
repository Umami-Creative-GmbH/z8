"use client";

import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { getNativePushClient, nativePushTapTarget } from "@/lib/store-app/native-push";

async function activeOrganizationId(): Promise<string | null> {
	try {
		const { data } = await authClient.getSession();
		return data?.session.activeOrganizationId ?? null;
	} catch {
		return null;
	}
}

/**
 * Store app shell only (#843): re-registers this device's push token on start,
 * saves rotated tokens and opens tapped notifications at their path, switching
 * organization first when needed. Renders nothing; a no-op in browsers.
 */
export function NativePushBridge() {
	useEffect(() => {
		let disposed = false;
		let stop: (() => Promise<void>) | null = null;

		void (async () => {
			const client = await getNativePushClient();
			if (!client || disposed) return;
			const remove = await client.listen((data) => {
				void activeOrganizationId().then((organizationId) => {
					window.location.assign(nativePushTapTarget(data, organizationId));
				});
			});
			if (disposed) {
				void remove();
				return;
			}
			stop = remove;
			await client.refresh();
		})().catch((error: unknown) => {
			console.error("Native push setup failed:", error);
		});

		return () => {
			disposed = true;
			void stop?.();
		};
	}, []);

	return null;
}
