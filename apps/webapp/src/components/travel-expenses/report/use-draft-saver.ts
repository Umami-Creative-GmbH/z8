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
	/** Reports edits that could not be saved after the editor was closed. */
	onUnsavedAfterClose: () => void;
}) {
	const save = useRef(options.save);
	const onLostAfterUnmount = useRef(options.onUnsavedAfterClose);
	useLayoutEffect(() => {
		save.current = options.save;
		onLostAfterUnmount.current = options.onUnsavedAfterClose;
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
			// Starts any pending save before the editor goes away. With no editor
			// left to show its outcome, a failure is reported as a notice.
			void saver.flush().then(() => {
				const { status } = saver.getState();
				if (status === "failed" || status === "conflict") onLostAfterUnmount.current();
			});
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
