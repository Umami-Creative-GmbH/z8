"use client";

import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import type { WidgetId } from "./widget-registry";

/**
 * A store that tracks which widgets are currently visible/mounted in the DOM.
 * Uses useSyncExternalStore for proper React 18 concurrent mode support.
 */
function createVisibilityStore() {
	const visibleWidgets = new Set<WidgetId>();
	const listeners = new Set<() => void>();
	// Cache the snapshot array - only update when data changes
	let cachedSnapshot: WidgetId[] = [];

	function subscribe(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	function getSnapshot(): WidgetId[] {
		return cachedSnapshot;
	}

	function updateSnapshot() {
		cachedSnapshot = Array.from(visibleWidgets);
	}

	function register(id: WidgetId) {
		if (!visibleWidgets.has(id)) {
			visibleWidgets.add(id);
			updateSnapshot();
			// Notify listeners asynchronously to avoid state updates during render
			queueMicrotask(() => {
				listeners.forEach((listener) => {
					listener();
				});
			});
		}
	}

	function unregister(id: WidgetId) {
		if (visibleWidgets.has(id)) {
			visibleWidgets.delete(id);
			updateSnapshot();
			queueMicrotask(() => {
				listeners.forEach((listener) => {
					listener();
				});
			});
		}
	}

	return { subscribe, getSnapshot, register, unregister };
}

type VisibilityStore = ReturnType<typeof createVisibilityStore>;

const EMPTY_WIDGETS: WidgetId[] = [];
const EMPTY_VISIBILITY_STORE: VisibilityStore = {
	subscribe: () => () => {},
	getSnapshot: () => EMPTY_WIDGETS,
	register: () => {},
	unregister: () => {},
};

const WidgetVisibilityContext = createContext<VisibilityStore | null>(null);

interface WidgetVisibilityProviderProps {
	children: ReactNode;
}

export function WidgetVisibilityProvider({ children }: WidgetVisibilityProviderProps) {
	const store = useMemo(() => createVisibilityStore(), []);

	return (
		<WidgetVisibilityContext.Provider value={store}>{children}</WidgetVisibilityContext.Provider>
	);
}

/**
 * Hook to register a widget as visible when mounted.
 * Automatically unregisters when unmounted.
 */
export function useRegisterVisibleWidget(id: WidgetId) {
	const store = useContext(WidgetVisibilityContext);
	const registered = useRef(false);

	useEffect(() => {
		if (store && !registered.current) {
			registered.current = true;
			store.register(id);
		}
		return () => {
			if (store && registered.current) {
				registered.current = false;
				store.unregister(id);
			}
		};
	}, [store, id]);
}

/**
 * Hook to get the list of currently visible widget IDs.
 */
export function useVisibleWidgets(): WidgetId[] {
	const store = useContext(WidgetVisibilityContext);
	const activeStore = store ?? EMPTY_VISIBILITY_STORE;

	return useSyncExternalStore(
		activeStore.subscribe,
		activeStore.getSnapshot,
		activeStore.getSnapshot,
	);
}
