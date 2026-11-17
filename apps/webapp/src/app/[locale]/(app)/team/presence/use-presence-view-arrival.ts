"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { LocationPresenceViewScope } from "./location-presence-view";

const retired = Symbol("retired presence view");
type Stamp = string | typeof retired | null;

function createArrivals() {
	const views = new WeakMap<LocationPresenceViewScope, Stamp>();
	const listeners = new Set<() => void>();
	const snapshot = (view: LocationPresenceViewScope) => views.get(view) ?? null;
	const publish = (view: LocationPresenceViewScope, stamp: Stamp) => {
		if (snapshot(view) === stamp) return;
		views.set(view, stamp);
		for (const listener of listeners) listener();
	};
	return {
		snapshot,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		accept: (view: LocationPresenceViewScope, identity: string) => publish(view, identity),
		retire(view: LocationPresenceViewScope) {
			if (snapshot(view) !== null) publish(view, retired);
		},
	};
}

// Only presentation retirement survives provider remounts; no roster data is retained here.
const arrivals = new WeakMap<QueryClient, ReturnType<typeof createArrivals>>();
function forClient(client: QueryClient) {
	let state = arrivals.get(client);
	if (!state) {
		state = createArrivals();
		arrivals.set(client, state);
	}
	return state;
}
const serverSnapshot = () => null;

export function usePresenceViewArrival(
	view: LocationPresenceViewScope,
	identity: string,
	matches: boolean,
) {
	const state = forClient(useQueryClient());
	const connected = useRef<LocationPresenceViewScope | null>(null);
	const stamp = useSyncExternalStore(state.subscribe, () => state.snapshot(view), serverSnapshot);
	useLayoutEffect(() => {
		connected.current = view;
		const current = state.snapshot(view);
		if (current === null && matches) state.accept(view, identity);
		else if (current !== null && current !== identity) state.retire(view);
		return () => {
			connected.current = null;
			queueMicrotask(() => {
				// StrictMode's immediate reconnect keeps the view; actual departure retires it.
				if (connected.current !== view) state.retire(view);
			});
		};
	}, [view, identity, matches, state]);
	return matches && stamp !== retired && (stamp === null || stamp === identity);
}
