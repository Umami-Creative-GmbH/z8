"use client";
import { useLayoutEffect, useRef } from "react";

/** Ignore completions from a departed form, including Activity hide/reveal. */
export function useBalanceFormRequest() {
	const arrival = useRef<object | null>(null);
	const pending = useRef(false);
	useLayoutEffect(() => {
		const token = {};
		arrival.current = token;
		pending.current = false;
		return () => {
			arrival.current = null;
		};
	}, []);
	return {
		begin: () => {
			if (pending.current || !arrival.current) return null;
			pending.current = true;
			return arrival.current;
		},
		current: (token: object) => arrival.current === token,
		finish: (token: object) => {
			if (arrival.current === token) pending.current = false;
		},
		pending: () => pending.current,
	};
}
