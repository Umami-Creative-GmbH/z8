"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ServerActionResult } from "@/lib/effect/result";

// Only arrival metadata is retained. Neither map keeps a server snapshot or client alive.
const received = new WeakMap<QueryClient, WeakMap<object, Set<string>>>();

function wasReceived(client: QueryClient, snapshot: object, scope: string) {
	return received.get(client)?.get(snapshot)?.has(scope) ?? false;
}

/** A serialized server result may seed its scoped query once, including after a fresh refresh. */
export function useDeveloperServerSnapshot<T>({
	queryKey: [prefix, organizationId, userId],
	snapshot,
	initialError,
}: {
	queryKey: readonly [string, string, string];
	snapshot: T[];
	initialError?: boolean;
}) {
	const client = useQueryClient();
	const scope = JSON.stringify([prefix, organizationId, userId]);
	useEffect(() => {
		if (initialError || wasReceived(client, snapshot, scope)) return;
		let snapshots = received.get(client);
		if (!snapshots) {
			snapshots = new WeakMap();
			received.set(client, snapshots);
		}
		let scopes = snapshots.get(snapshot);
		if (!scopes) {
			scopes = new Set();
			snapshots.set(snapshot, scopes);
		}
		scopes.add(scope);
		const result: ServerActionResult<T[]> = {
			success: true,
			data: snapshot,
		};
		client.setQueryData([prefix, organizationId, userId], result);
	}, [client, prefix, organizationId, userId, snapshot, initialError, scope]);
	return (): ServerActionResult<T[]> | undefined =>
		initialError || wasReceived(client, snapshot, scope)
			? undefined
			: { success: true, data: snapshot };
}
