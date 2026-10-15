"use client";

import { type Dispatch, type SetStateAction, useCallback, useState } from "react";

/** Local updates to fetched data, replaced when fresh server props arrive.
 * Use for saved lists/status only; keep unsaved form values in their own state.
 */
export function useServerDataState<T>(source: T): [T, Dispatch<SetStateAction<T>>] {
	const [snapshot, setSnapshot] = useState({ source, value: source });
	if (snapshot.source !== source) {
		setSnapshot({ source, value: source });
	}
	const setValue: Dispatch<SetStateAction<T>> = useCallback((update) => {
		setSnapshot((current) => ({
			...current,
			value: typeof update === "function" ? (update as (previous: T) => T)(current.value) : update,
		}));
	}, []);
	return [snapshot.source === source ? snapshot.value : source, setValue];
}
