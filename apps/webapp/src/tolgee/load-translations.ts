import "server-only";
import type { TolgeeStaticData } from "@tolgee/react";
import { cacheLife } from "next/cache";
import { ALL_NAMESPACES, loadNamespaces } from "./shared";

export async function loadRouteTranslations(locale: string): Promise<TolgeeStaticData> {
	"use cache";
	cacheLife("max");
	return loadNamespaces(locale, ALL_NAMESPACES);
}
