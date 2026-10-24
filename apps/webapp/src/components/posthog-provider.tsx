"use client";

import { useEffect } from "react";
import { env } from "@/env";

type PostHogProviderProps = {
	children: React.ReactNode;
	disabled: boolean;
	helpImproveProduct: boolean;
	identityKey: string;
};

let postHogLoad: Promise<typeof import("posthog-js")> | undefined;
function loadPostHog() {
	// Share the module download across effect replay and consent/identity changes.
	postHogLoad ??= import("posthog-js");
	return postHogLoad;
}

export function PostHogProvider({
	children,
	disabled,
	helpImproveProduct,
	identityKey,
}: PostHogProviderProps) {
	const projectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
	const enabled = !disabled && helpImproveProduct && !!projectToken;
	useEffect(() => {
		if (!enabled || !identityKey) return;
		let cancelled = false;
		let stop: (() => void) | undefined;
		void loadPostHog()
			.then(({ default: posthog }) => {
				if (cancelled) return;
				stop = () => {
					stop = undefined;
					// Optional analytics failures must never break app cleanup or transitions.
					try {
						posthog.opt_out_capturing();
					} catch {
						/* best effort */
					}
					try {
						posthog.reset();
					} catch {
						/* best effort */
					}
				};
				posthog.init(projectToken, {
					api_host: "/ingest",
					ui_host: env.NEXT_PUBLIC_POSTHOG_HOST,
					defaults: "2026-01-30",
					capture_pageview: "history_change",
					capture_pageleave: true,
				});
				posthog.opt_in_capturing();
			})
			.catch(() => {
				stop?.();
			});
		return () => {
			cancelled = true;
			stop?.();
		};
	}, [enabled, projectToken, identityKey]);
	// Analytics never changes the application tree or owns its lifecycle.
	return <>{children}</>;
}
