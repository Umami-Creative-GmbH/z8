"use client";

import { useTranslate } from "@tolgee/react";
import type { ComponentProps } from "react";

export interface LoadingTranslation {
	labelKey: string;
	labelDefault: string;
}

/** Localizes streaming fallbacks without waiting for a server translation request. */
export function LoadingRegion({
	as: Element = "div",
	label,
	...props
}: Omit<ComponentProps<"div">, "aria-label"> & {
	as?: "div" | "main" | "section";
	label: LoadingTranslation;
}) {
	const { t } = useTranslate();
	return (
		<Element aria-label={t(label.labelKey, label.labelDefault)} {...props} />
	);
}
