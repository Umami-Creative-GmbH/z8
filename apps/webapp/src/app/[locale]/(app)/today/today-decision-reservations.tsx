"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, use, useState, useSyncExternalStore } from "react";
import type { TodayScope } from "./today-types";

function createReservations() {
	let pending: { approvalId: string; token: object } | null = null;
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	return {
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		snapshot: () => pending?.approvalId ?? null,
		serverSnapshot: () => null,
		reserve(approvalId: string) {
			if (pending) return null;
			const token = {};
			pending = { approvalId, token };
			notify();
			return token;
		},
		release(token: object) {
			if (pending?.token !== token) return;
			pending = null;
			notify();
		},
	};
}

type Reservations = ReturnType<typeof createReservations>;
const ReservationContext = createContext<Reservations | null>(null);
// Browser QueryClient lifetime, actor and organization only. No rows, results or access grants.
const owners = new WeakMap<QueryClient, Map<string, Reservations>>();

function scopeReservations(client: QueryClient, scope: TodayScope) {
	let scopes = owners.get(client);
	if (!scopes) {
		scopes = new Map();
		owners.set(client, scopes);
	}
	const key = JSON.stringify([scope.userId, scope.organizationId]);
	let reservations = scopes.get(key);
	if (!reservations) {
		reservations = createReservations();
		scopes.set(key, reservations);
	}
	return reservations;
}

export function TodayDecisionReservations({
	scope,
	children,
}: {
	scope: TodayScope;
	children: ReactNode;
}) {
	const client = useQueryClient();
	return (
		<ReservationContext value={scopeReservations(client, scope)}>{children}</ReservationContext>
	);
}

export function useTodayDecisionReservation() {
	const provided = use(ReservationContext);
	const [local] = useState(createReservations);
	const reservations = provided ?? local;
	const pendingApprovalId = useSyncExternalStore(
		reservations.subscribe,
		reservations.snapshot,
		reservations.serverSnapshot,
	);
	return { pendingApprovalId, reserve: reservations.reserve, release: reservations.release };
}
