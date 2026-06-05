"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import { env } from "@/env";

type PostHogProviderProps = {
	children: React.ReactNode;
	helpImproveProduct: boolean;
};

export function PostHogProvider({ children, helpImproveProduct }: PostHogProviderProps) {
	const projectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
	const isPostHogEnabled = process.env.NODE_ENV !== "development" && !!projectToken;

	useEffect(() => {
		if (!isPostHogEnabled) {
			return;
		}

		if (!helpImproveProduct) {
			posthog.opt_out_capturing();
			posthog.reset();
			return;
		}

		posthog.init(projectToken, {
			api_host: "/ingest",
			ui_host: env.NEXT_PUBLIC_POSTHOG_HOST,
			defaults: "2026-01-30",
			capture_pageview: "history_change",
			capture_pageleave: true,
		});
		posthog.opt_in_capturing();
	}, [helpImproveProduct, isPostHogEnabled, projectToken]);

	if (!(isPostHogEnabled && helpImproveProduct)) {
		return <>{children}</>;
	}

	return <PHProvider client={posthog}>{children}</PHProvider>;
}
