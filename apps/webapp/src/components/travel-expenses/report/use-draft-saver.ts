"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	createDraftSaver,
	type DraftSaveOutcome,
	type DraftSaver,
} from "@/lib/travel-expenses/draft-saver";

const AUTOSAVE_DELAY_MS = 800;

/**
 * Binds one draft saver to the component's lifetime. Pending edits are saved
 * when the page is hidden (mobile app switch) or the editor unmounts, and the
 * browser warns before leaving while edits or uploads are unsaved.
 */
export function useDraftSaver<Values, Item>(options: {
	version: number;
	save: (values: Values, expectedVersion: number) => Promise<DraftSaveOutcome<Item>>;
	/** Extra work that must finish before leaving, e.g. a receipt upload. */
	isBusy?: boolean;
}) {
	const save = useRef(options.save);
	useLayoutEffect(() => {
		save.current = options.save;
	});
	const [saver] = useState<DraftSaver<Values, Item>>(() =>
		createDraftSaver<Values, Item>({
			version: options.version,
			delayMs: AUTOSAVE_DELAY_MS,
			save: (values, version) => save.current(values, version),
		}),
	);
	const state = useSyncExternalStore(saver.subscribe, saver.getState, saver.getState);

	useEffect(() => {
		const flushWhenHidden = () => {
			if (document.visibilityState === "hidden") void saver.flush();
		};
		document.addEventListener("visibilitychange", flushWhenHidden);
		return () => {
			document.removeEventListener("visibilitychange", flushWhenHidden);
			// Starts any pending save before the editor goes away.
			void saver.flush();
		};
	}, [saver]);

	const unsaved = state.status !== "saved" || Boolean(options.isBusy);
	useEffect(() => {
		if (!unsaved) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [unsaved]);

	return { saver, state };
}
