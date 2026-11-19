"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ServerActionResult } from "@/lib/effect/result";

type DeveloperQueryKey = readonly ["apiKeys" | "developerWebhooks", string, string];
type Arrival = { readonly version: object };
type ClientArrivals = {
	versions: Map<string, object>;
	sources: WeakMap<object, Map<string, Arrival>>;
	consumed: WeakSet<Arrival>;
};
// Query-client lifetime metadata only: no list values, query objects or authorization decisions.
const clients = new WeakMap<QueryClient, ClientArrivals>();

function developerScope(key: readonly unknown[]) {
	if (
		key.length !== 3 ||
		(key[0] !== "apiKeys" && key[0] !== "developerWebhooks") ||
		typeof key[1] !== "string" ||
		typeof key[2] !== "string"
	)
		return null;
	return JSON.stringify(key);
}
function clientArrivals(client: QueryClient) {
	const existing = clients.get(client);
	if (existing) return existing;
	const owner: ClientArrivals = {
		versions: new Map(),
		sources: new WeakMap(),
		consumed: new WeakSet(),
	};
	clients.set(client, owner);
	// One listener owned by this QueryCache lifetime. It never publishes query data or React updates.
	client.getQueryCache().subscribe((event) => {
		const scope = developerScope(event.query.queryKey);
		if (scope === null) return;
		if (
			event.type === "added" ||
			event.type === "removed" ||
			(event.type === "updated" &&
				(event.action.type === "success" ||
					event.action.type === "error" ||
					event.action.type === "setState"))
		) {
			owner.versions.set(scope, {});
		}
	});
	return owner;
}
function currentVersion(owner: ClientArrivals, scope: string) {
	let version = owner.versions.get(scope);
	if (!version) {
		version = {};
		owner.versions.set(scope, version);
	}
	return version;
}
function sourceArrival(owner: ClientArrivals, snapshot: object, scope: string) {
	let scopes = owner.sources.get(snapshot);
	if (!scopes) {
		scopes = new Map();
		owner.sources.set(snapshot, scopes);
	}
	let arrival = scopes.get(scope);
	if (!arrival) {
		arrival = { version: currentVersion(owner, scope) };
		scopes.set(scope, arrival);
	}
	return arrival;
}
function consumeArrival(owner: ClientArrivals, arrival: Arrival) {
	if (owner.consumed.has(arrival)) return false;
	owner.consumed.add(arrival);
	return true;
}

/** Observe both route props even while their tab panels have never rendered. */
export function useDeveloperSnapshotArrivals({
	organizationId,
	userId,
	apiKeys,
	webhooks,
}: {
	organizationId: string;
	userId: string;
	apiKeys: readonly unknown[];
	webhooks: readonly unknown[];
}) {
	const owner = clientArrivals(useQueryClient());
	sourceArrival(owner, apiKeys, JSON.stringify(["apiKeys", organizationId, userId]));
	sourceArrival(owner, webhooks, JSON.stringify(["developerWebhooks", organizationId, userId]));
}

/** Observe source identity before effects; only an unsuperseded arrival may seed its query. */
export function useDeveloperServerSnapshot<T>({
	queryKey: [prefix, organizationId, userId],
	snapshot,
	initialError,
}: {
	queryKey: DeveloperQueryKey;
	snapshot: T[];
	initialError?: boolean;
}) {
	const client = useQueryClient();
	const scope = JSON.stringify([prefix, organizationId, userId]);
	// Idempotent weak memoization must survive an uncommitted hidden tree being remounted.
	// This never writes query data during render; TanStack owns initialData construction.
	const owner = clientArrivals(client);
	const arrival = sourceArrival(owner, snapshot, scope);
	useEffect(() => {
		if (initialError || !consumeArrival(owner, arrival)) return;
		const queryKey: DeveloperQueryKey = [prefix, organizationId, userId];
		const current = client.getQueryData<ServerActionResult<T[]>>(queryKey);
		// Query construction can already have initialized itself from this exact snapshot.
		if (current?.success && current.data === snapshot) return;
		if (arrival.version !== currentVersion(owner, scope)) return;
		const result: ServerActionResult<T[]> = { success: true, data: snapshot };
		client.setQueryData(queryKey, result);
	}, [client, prefix, organizationId, userId, snapshot, initialError, scope, owner, arrival]);
	return (): ServerActionResult<T[]> | undefined =>
		initialError || owner.consumed.has(arrival) || arrival.version !== currentVersion(owner, scope)
			? undefined
			: { success: true, data: snapshot };
}
