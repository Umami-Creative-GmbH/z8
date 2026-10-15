"use client";

import { type Dispatch, type SetStateAction, useCallback, useState } from "react";

/** Refresh a pristine manual draft; keep edited values until they are saved. */
export function useServerDraftState<T>(
	source: T,
): [T, Dispatch<SetStateAction<T>>, (saved: T) => void] {
	const [snapshot, setSnapshot] = useState({ source, value: source, dirty: false });
	if (snapshot.source !== source) {
		setSnapshot({ source, value: snapshot.dirty ? snapshot.value : source, dirty: snapshot.dirty });
	}
	const setValue: Dispatch<SetStateAction<T>> = useCallback((update) => {
		setSnapshot((current) => ({
			...current,
			dirty: true,
			value: typeof update === "function" ? (update as (previous: T) => T)(current.value) : update,
		}));
	}, []);
	const markSaved = useCallback((saved: T) => {
		setSnapshot((current) => (current.value === saved ? { ...current, dirty: false } : current));
	}, []);
	return [
		snapshot.source === source || snapshot.dirty ? snapshot.value : source,
		setValue,
		markSaved,
	];
}
