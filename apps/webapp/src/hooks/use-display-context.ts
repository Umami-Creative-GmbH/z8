"use client";

import { useLocale } from "next-intl";
import { useTimeFormat, useUserTimezone } from "@/components/providers/user-preferences-provider";
import type { DisplayContext } from "@/lib/datetime/temporal-format";

export function useDisplayContext(): DisplayContext {
	return {
		locale: useLocale(),
		timezone: useUserTimezone(),
		timeFormat: useTimeFormat(),
	};
}
