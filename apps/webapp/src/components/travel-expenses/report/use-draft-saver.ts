"use client";

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
	createDraftSaver,
	type DraftSaveOutcome,
	type DraftSaver,
} from "@/lib/travel-expenses/draft-saver";

const AUTOSAVE_DELAY_MS = 800;

/** Holds the latest value for callbacks that outlive the render that created them. */
function createLatestBox<T>(initial: T) {
	let current = initial;
	return {
		get: () => current,
		set: (next: T) => {
			current = next;
		},
	};
}

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
	// A box rather than refs: the saver is created during render, and the React
	// Compiler refuses closures over refs there.
	const [latest] = useState(() => createLatestBox(options));
	useLayoutEffect(() => {
		latest.set(options);
	});
	const [saver] = useState<DraftSaver<Values, Item>>(() =>
		createDraftSaver<Values, Item>({
			version: options.version,
			delayMs: AUTOSAVE_DELAY_MS,
			save: (values, version) => latest.get().save(values, version),
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
				if (status === "failed" || status === "conflict") latest.get().onUnsavedAfterClose();
			});
		};
	}, [latest, saver]);

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
