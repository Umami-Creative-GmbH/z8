import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDraftSaver, type DraftSaveOutcome } from "../draft-saver";

type Values = { description: string };

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("createDraftSaver", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function setup(initialVersion = 1) {
		const calls: { values: Values; version: number }[] = [];
		const pending: ReturnType<typeof deferred<DraftSaveOutcome<Values>>>[] = [];
		const saver = createDraftSaver<Values, Values>({
			version: initialVersion,
			delayMs: 500,
			save: (values, version) => {
				calls.push({ values, version });
				const next = deferred<DraftSaveOutcome<Values>>();
				pending.push(next);
				return next.promise;
			},
		});
		return { saver, calls, pending };
	}

	it("starts saved, reports unsaved changes and debounces them into one save", async () => {
		const { saver, calls, pending } = setup();
		expect(saver.getState().status).toBe("saved");

		saver.change({ description: "H" });
		saver.change({ description: "Hotel" });
		expect(saver.getState().status).toBe("pending");
		await vi.advanceTimersByTimeAsync(499);
		expect(calls).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(1);
		expect(calls).toEqual([{ values: { description: "Hotel" }, version: 1 }]);
		expect(saver.getState().status).toBe("saving");

		pending[0]!.resolve({ status: "saved", version: 2 });
		await vi.runAllTimersAsync();
		expect(saver.getState()).toMatchObject({ status: "saved", version: 2 });
	});

	it("never runs two saves at once and saves edits made meanwhile on the new version", async () => {
		const { saver, calls, pending } = setup();
		saver.change({ description: "First" });
		await vi.advanceTimersByTimeAsync(500);
		saver.change({ description: "Second" });
		await vi.advanceTimersByTimeAsync(500);
		expect(calls).toHaveLength(1);
		expect(saver.getState().status).toBe("saving");

		pending[0]!.resolve({ status: "saved", version: 2 });
		await vi.advanceTimersByTimeAsync(0);
		expect(calls[1]).toEqual({ values: { description: "Second" }, version: 2 });
		pending[1]!.resolve({ status: "saved", version: 3 });
		await vi.runAllTimersAsync();
		expect(saver.getState()).toMatchObject({ status: "saved", version: 3 });
	});

	it("reports a failed save, keeps the edits and saves them again on retry", async () => {
		const { saver, calls, pending } = setup();
		saver.change({ description: "Hotel" });
		await vi.advanceTimersByTimeAsync(500);
		pending[0]!.reject(new Error("offline"));
		await vi.advanceTimersByTimeAsync(0);
		expect(saver.getState()).toMatchObject({ status: "failed", version: 1 });

		saver.retry();
		await vi.advanceTimersByTimeAsync(0);
		expect(calls[1]).toEqual({ values: { description: "Hotel" }, version: 1 });
		pending[1]!.resolve({ status: "saved", version: 2 });
		await vi.runAllTimersAsync();
		expect(saver.getState()).toMatchObject({ status: "saved", version: 2 });
	});

	it("treats a failed outcome like a thrown error", async () => {
		const { saver, pending } = setup();
		saver.change({ description: "Hotel" });
		await vi.advanceTimersByTimeAsync(500);
		pending[0]!.resolve({ status: "failed", error: "Server unavailable" });
		await vi.advanceTimersByTimeAsync(0);
		expect(saver.getState()).toMatchObject({ status: "failed", error: "Server unavailable" });
	});

	it("stops on a conflict and never overwrites the newer version on its own", async () => {
		const { saver, calls, pending } = setup();
		saver.change({ description: "Mine" });
		await vi.advanceTimersByTimeAsync(500);
		pending[0]!.resolve({ status: "conflict", version: 5, item: { description: "Theirs" } });
		await vi.advanceTimersByTimeAsync(0);
		expect(saver.getState()).toMatchObject({
			status: "conflict",
			version: 1,
			conflict: { version: 5, item: { description: "Theirs" } },
		});

		saver.change({ description: "Mine, edited" });
		await vi.advanceTimersByTimeAsync(5000);
		expect(calls).toHaveLength(1);
		expect(saver.getState().status).toBe("conflict");
	});

	it("can adopt the newer version, discarding the local edits", async () => {
		const { saver, calls, pending } = setup();
		saver.change({ description: "Mine" });
		await vi.advanceTimersByTimeAsync(500);
		pending[0]!.resolve({ status: "conflict", version: 5, item: { description: "Theirs" } });
		await vi.advanceTimersByTimeAsync(0);

		saver.resolveConflict("use_theirs");
		expect(saver.getState()).toMatchObject({ status: "saved", version: 5 });
		await vi.runAllTimersAsync();
		expect(calls).toHaveLength(1);
	});

	it("can explicitly save the local edits over the newer version", async () => {
		const { saver, calls, pending } = setup();
		saver.change({ description: "Mine" });
		await vi.advanceTimersByTimeAsync(500);
		pending[0]!.resolve({ status: "conflict", version: 5, item: { description: "Theirs" } });
		await vi.advanceTimersByTimeAsync(0);

		saver.resolveConflict("keep_mine");
		await vi.advanceTimersByTimeAsync(0);
		expect(calls[1]).toEqual({ values: { description: "Mine" }, version: 5 });
		pending[1]!.resolve({ status: "saved", version: 6 });
		await vi.runAllTimersAsync();
		expect(saver.getState()).toMatchObject({ status: "saved", version: 6 });
	});

	it("reports invalid fields and saves again once they change", async () => {
		const { saver, calls, pending } = setup();
		saver.change({ description: "x" });
		await vi.advanceTimersByTimeAsync(500);
		pending[0]!.resolve({ status: "invalid", errors: { description: "too_long" } });
		await vi.advanceTimersByTimeAsync(0);
		expect(saver.getState()).toMatchObject({
			status: "invalid",
			fieldErrors: { description: "too_long" },
		});

		saver.change({ description: "y" });
		await vi.advanceTimersByTimeAsync(500);
		expect(calls).toHaveLength(2);
	});

	it("saves pending edits immediately on flush", async () => {
		const { saver, calls } = setup();
		saver.change({ description: "Leaving" });
		void saver.flush();
		await vi.advanceTimersByTimeAsync(0);
		expect(calls).toEqual([{ values: { description: "Leaving" }, version: 1 }]);
	});

	it("notifies subscribers on every state change", async () => {
		const { saver } = setup();
		const listener = vi.fn();
		const unsubscribe = saver.subscribe(listener);
		saver.change({ description: "Hotel" });
		expect(listener).toHaveBeenCalled();
		unsubscribe();
		listener.mockClear();
		saver.change({ description: "Hotel 2" });
		expect(listener).not.toHaveBeenCalled();
	});

	it("does nothing after it is disposed", async () => {
		const { saver, calls } = setup();
		saver.change({ description: "Hotel" });
		saver.dispose();
		await vi.runAllTimersAsync();
		expect(calls).toHaveLength(0);
	});
});
