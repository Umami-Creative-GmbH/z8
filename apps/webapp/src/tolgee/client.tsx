"use client";

import { TolgeeProvider, type TolgeeStaticData, useTolgee } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type Namespace, TolgeeBase } from "./shared";

type Props = {
	language: string;
	staticData: TolgeeStaticData;
	children: React.ReactNode;
};

const tolgeeCache = new Map<string, ReturnType<ReturnType<typeof TolgeeBase>["init"]>>();
const addedStaticData = new WeakMap<object, WeakSet<object>>();

function addStaticDataOnce(
	instance: ReturnType<ReturnType<typeof TolgeeBase>["init"]>,
	staticData: TolgeeStaticData,
) {
	let instanceData = addedStaticData.get(instance);
	if (!instanceData) {
		instanceData = new WeakSet();
		addedStaticData.set(instance, instanceData);
	}

	if (!instanceData.has(staticData)) {
		instance.addStaticData(staticData);
		instanceData.add(staticData);
	}
}

function getOrCreateTolgee(language: string, staticData: TolgeeStaticData) {
	let instance = tolgeeCache.get(language);
	if (!instance) {
		instance = TolgeeBase().init({
			language,
			staticData,
		});
		tolgeeCache.set(language, instance);
	}
	addStaticDataOnce(instance, staticData);
	return instance;
}

export const TolgeeNextProvider = ({ language, staticData, children }: Props) => {
	const { refresh } = useRouter();

	const tolgee = useMemo(() => getOrCreateTolgee(language, staticData), [language, staticData]);

	useEffect(() => {
		// this ensures server components refresh, after translation change
		const { unsubscribe } = tolgee.on("permanentChange", () => {
			refresh();
		});
		return () => unsubscribe();
	}, [refresh, tolgee]);

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
 *   const { isLoading, isLoaded } = useNamespaces(["settings/generic", "calendar"]);
 *   if (isLoading) return <Spinner />;
 *   return <div>{t("settings.title")}</div>;
 * }
 */
export function useNamespaces(namespaces: Namespace[]): {
	isLoading: boolean;
	isLoaded: boolean;
} {
	const tolgeeInstance = useTolgee();
	const namespaceKey = namespaces.join("|");
	const hasNamespaces = namespaceKey.length > 0;
	const [loadState, setLoadState] = useState(() => ({
		key: namespaceKey,
		isLoading: hasNamespaces,
		isLoaded: !hasNamespaces,
	}));

	if (loadState.key !== namespaceKey) {
		setLoadState({
			key: namespaceKey,
			isLoading: hasNamespaces,
			isLoaded: !hasNamespaces,
		});
	}

	useEffect(() => {
		let cancelled = false;

		void Promise.resolve().then(async () => {
			if (!hasNamespaces) return;

			const namespacesToLoad = namespaceKey.split("|") as Namespace[];

			try {
				// Tolgee will automatically load the namespaces via staticData
				// when a key from that namespace is accessed.
				await tolgeeInstance.addActiveNs(namespacesToLoad);
				if (!cancelled) {
					setLoadState({ key: namespaceKey, isLoading: false, isLoaded: true });
				}
			} catch (error) {
				console.warn("Failed to load namespaces:", namespacesToLoad, error);
				if (!cancelled) {
					setLoadState({ key: namespaceKey, isLoading: false, isLoaded: false });
				}
			}
		});

		return () => {
			cancelled = true;
		};
	}, [hasNamespaces, namespaceKey, tolgeeInstance]);

	return { isLoading: loadState.isLoading, isLoaded: loadState.isLoaded };
}

/**
 * Preload namespaces without blocking render
 * Call this early in a component to start loading namespaces in the background
 */
export function preloadNamespaces(namespaces: Namespace[]): void {
	if (typeof window !== "undefined" && namespaces.length > 0) {
		const instance = tolgeeCache.values().next().value;
		if (instance) {
			instance.addActiveNs(namespaces).catch((error: unknown) => {
				console.warn("Failed to preload namespaces:", namespaces, error);
			});
		}
	}
}
