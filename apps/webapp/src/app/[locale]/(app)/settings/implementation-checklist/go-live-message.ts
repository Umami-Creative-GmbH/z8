import type { useTranslate } from "@tolgee/react";
import type { GoLiveMessage } from "@/lib/implementation-checklist/go-live/types";

export type Translate = ReturnType<typeof useTranslate>["t"];

/** Shows a go-live message: its key, English default and ICU params. */
export function goLiveMessage(t: Translate, text: GoLiveMessage) {
	return t(text.key, text.fallback, text.params);
}
