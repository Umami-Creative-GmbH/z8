"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/** Initialize once per opening/record, so refreshed query data cannot replace a draft. */
export function useEditSession({
	open,
	scope,
	ready = true,
	initialize,
}: {
	open: boolean;
	scope: string;
	ready?: boolean;
	initialize: () => void;
}) {
	const initializedScope = useRef<string | null>(null);
	const initializeForEffect = useEffectEvent(initialize);
	useEffect(() => {
		if (!open) {
			initializedScope.current = null;
			return;
		}
		if (!ready || initializedScope.current === scope) return;
		initializedScope.current = scope;
		initializeForEffect();
	}, [open, scope, ready]);
}
