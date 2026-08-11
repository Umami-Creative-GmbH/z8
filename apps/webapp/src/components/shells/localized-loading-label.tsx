"use client";

import { useTranslate } from "@tolgee/react";

export function LocalizedLoadingLabel({
	translationKey,
	fallback,
}: {
	translationKey: string;
	fallback: string;
}) {
	const { t } = useTranslate();

	return <span className="sr-only">{t(translationKey, fallback)}</span>;
}
