"use client";

import { useTranslate } from "@tolgee/react";

export function TranslatedColumnHeader({
	className,
	fallback,
	nameKey,
}: {
	className?: string;
	fallback: string;
	nameKey: string;
}) {
	const { t } = useTranslate();

	return <span className={className}>{t(nameKey, fallback)}</span>;
}
