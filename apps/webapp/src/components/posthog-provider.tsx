"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import { env } from "@/env";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
	const projectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();

	useEffect(() => {
		if (!projectToken) {
			return;
		}

		posthog.init(projectToken, {
			api_host: "/ingest",
			ui_host: env.NEXT_PUBLIC_POSTHOG_HOST,
			defaults: "2026-01-30",
			capture_pageview: "history_change",
			capture_pageleave: true,
		});
	}, [projectToken]);

	if (!projectToken) {
		return <>{children}</>;
	}

	return <PHProvider client={posthog}>{children}</PHProvider>;
}
