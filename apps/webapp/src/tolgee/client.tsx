"use client";

import { TolgeeProvider, useTolgee, type TolgeeStaticData } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type Namespace, TolgeeBase } from "./shared";

type Props = {
	language: string;
	staticData: TolgeeStaticData;
	children: React.ReactNode;
};

const tolgee = TolgeeBase().init();

export const TolgeeNextProvider = ({ language, staticData, children }: Props) => {
	const router = useRouter();

	useEffect(() => {
		// this ensures server components refresh, after translation change
		const { unsubscribe } = tolgee.on("permanentChange", () => {
			router.refresh();
		});
		return () => unsubscribe();
	}, [router]);

	return (
		<TolgeeProvider ssr={{ language, staticData }} tolgee={tolgee}>
			{children}
		</TolgeeProvider>
	);
};

/**
 * Hook to load additional namespaces on the client side
 * Useful for components that need translations from namespaces not loaded during SSR
 *
 * @example
 * function MyComponent() {
 *   const { isLoading, isLoaded } = useNamespaces(["settings", "calendar"]);
 *   if (isLoading) return <Spinner />;
 *   return <div>{t("settings.title")}</div>;
 * }
 */
export function useNamespaces(namespaces: Namespace[]): {
	isLoading: boolean;
	isLoaded: boolean;
} {
	const tolgeeInstance = useTolgee();
	const [isLoading, setIsLoading] = useState(false);
	const [isLoaded, setIsLoaded] = useState(false);

	const loadNamespaces = useCallback(async () => {
		if (namespaces.length === 0) {
			setIsLoaded(true);
			return;
		}

		setIsLoading(true);
		try {
			// Tolgee will automatically load the namespaces via staticData
			// when a key from that namespace is accessed
			// We trigger loading by calling addActiveNs
			await tolgeeInstance.addActiveNs(namespaces);
			setIsLoaded(true);
		} catch (error) {
			console.warn("Failed to load namespaces:", namespaces, error);
		} finally {
			setIsLoading(false);
		}
	}, [tolgeeInstance, namespaces]);

	useEffect(() => {
		loadNamespaces();
	}, [loadNamespaces]);

	return { isLoading, isLoaded };
}

/**
 * Preload namespaces without blocking render
 * Call this early in a component to start loading namespaces in the background
 */
export function preloadNamespaces(namespaces: Namespace[]): void {
	if (typeof window !== "undefined" && namespaces.length > 0) {
		tolgee.addActiveNs(namespaces).catch((error) => {
			console.warn("Failed to preload namespaces:", namespaces, error);
		});
	}
}
