/**
 * Autosave controller for one versioned draft (#600). It debounces edits,
 * never runs two saves at once, always saves the latest edits on top of the
 * version the server last confirmed, and stops on a version conflict until the
 * user decides; it never overwrites a newer version on its own. Framework-free
 * so it can be tested without rendering.
 */

export type DraftSaveOutcome<Item> =
	| { status: "saved"; version: number }
	/** The draft changed elsewhere; `item` is the newer saved state. */
	| { status: "conflict"; version: number; item: Item }
	/**
	 * Some values are malformed. When the well-formed rest was still saved,
	 * `version` is the version that save produced.
	 */
	| { status: "invalid"; errors: Record<string, string>; version?: number }
	| { status: "failed"; error: string };

export type DraftSaverStatus =
	/** Everything entered is saved. */
	| "saved"
	/** Edits are waiting for the debounce. */
	| "pending"
	| "saving"
	| "failed"
	| "invalid"
	| "conflict";

export interface DraftSaverState<Item> {
	status: DraftSaverStatus;
	/** Version the next save is based on: the last one the server confirmed. */
	version: number;
	error?: string;
	fieldErrors?: Record<string, string>;
	conflict?: { version: number; item: Item };
}

export interface DraftSaver<Values, Item> {
	getState(): DraftSaverState<Item>;
	subscribe(listener: () => void): () => void;
	/** Records the latest complete values; they are saved after the debounce. */
	change(values: Values): void;
	/** Saves pending edits now. */
	flush(): Promise<void>;
	/** Saves the unsaved edits again after a failure. */
	retry(): void;
	/** Settles a conflict: adopt the newer saved version, or save the local edits over it. */
	resolveConflict(choice: "use_theirs" | "keep_mine"): void;
	/**
	 * Drops unsaved edits for good, e.g. after the draft was removed: nothing
	 * more is saved and the state reads as saved, so nothing is reported lost.
	 */
	discard(): void;
	dispose(): void;
}

export function createDraftSaver<Values, Item>(options: {
	version: number;
	delayMs: number;
	save: (values: Values, expectedVersion: number) => Promise<DraftSaveOutcome<Item>>;
}): DraftSaver<Values, Item> {
	let state: DraftSaverState<Item> = { status: "saved", version: options.version };
	const listeners = new Set<() => void>();
	let latest: Values | undefined;
	/** Edits exist that no save has started with yet. */
	let dirty = false;
	let inFlight: Promise<void> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	function setState(next: DraftSaverState<Item>) {
		state = next;
		for (const listener of listeners) listener();
	}

	function schedule(delayMs: number) {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			void run();
		}, delayMs);
	}

	async function run(): Promise<void> {
		if (disposed || inFlight || !dirty || latest === undefined) return inFlight ?? undefined;
		if (state.status === "conflict") return;
		const values = latest;
		const version = state.version;
		dirty = false;
		setState({ status: "saving", version });
		inFlight = (async () => {
			let outcome: DraftSaveOutcome<Item>;
			try {
				outcome = await options.save(values, version);
			} catch (error) {
				outcome = {
					status: "failed",
					error: error instanceof Error ? error.message : "Save failed",
				};
			}
			inFlight = null;
			if (disposed) return;
			switch (outcome.status) {
				case "saved":
					setState({ status: dirty ? "pending" : "saved", version: outcome.version });
					if (dirty) schedule(0);
					return;
				case "conflict":
					dirty = true;
					setState({
						status: "conflict",
						version,
						conflict: { version: outcome.version, item: outcome.item },
					});
					return;
				case "invalid":
					setState({
						status: "invalid",
						version: outcome.version ?? version,
						fieldErrors: outcome.errors,
					});
					if (dirty) schedule(options.delayMs);
					return;
				case "failed":
					dirty = true;
					setState({ status: "failed", version, error: outcome.error });
					return;
			}
		})();
		return inFlight;
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		change(values) {
			if (disposed) return;
			latest = values;
			dirty = true;
			if (state.status === "conflict") return;
			if (!inFlight && state.status !== "pending") {
				setState({ status: "pending", version: state.version });
			}
			schedule(options.delayMs);
		},
		async flush() {
			if (timer) clearTimeout(timer);
			timer = null;
			await run();
		},
		retry() {
			if (disposed || (state.status !== "failed" && state.status !== "invalid")) return;
			dirty = latest !== undefined;
			schedule(0);
		},
		resolveConflict(choice) {
			const conflict = state.conflict;
			if (disposed || state.status !== "conflict" || !conflict) return;
			if (choice === "use_theirs") {
				dirty = false;
				setState({ status: "saved", version: conflict.version });
				return;
			}
			setState({ status: "pending", version: conflict.version });
			dirty = true;
			schedule(0);
		},
		discard() {
			if (disposed) return;
			dirty = false;
			latest = undefined;
			setState({ status: "saved", version: state.version });
			dispose();
		},
		dispose,
	};

	function dispose() {
		disposed = true;
		if (timer) clearTimeout(timer);
		timer = null;
		listeners.clear();
	}
}
