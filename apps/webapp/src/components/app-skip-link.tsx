"use client";

import { useTranslate } from "@tolgee/react";

export function AppSkipLink() {
	const { t } = useTranslate();
	return (
		<a
			href="#app-page-content"
			className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-3 focus:text-foreground focus:shadow-md focus:outline-2 focus:outline-ring"
		>
			{t("common.skipToContent", "Skip to content")}
		</a>
	);
}
