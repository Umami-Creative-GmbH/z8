import { describe, expect, it, vi } from "vitest";
import { mapConcurrently } from "./map-concurrently";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("mapConcurrently", () => {
	it("bounds active tasks and returns results in input order", async () => {
		const gates = Array.from({ length: 4 }, deferred);
		const started: number[] = [];
		const pending = mapConcurrently([0, 1, 2, 3], 2, async (item) => {
			started.push(item);
			await gates[item].promise;
			return item * 10;
		});
		expect(started).toEqual([0, 1]);
		gates[1].resolve();
		await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));
		gates[2].resolve();
		await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
		gates[3].resolve();
		gates[0].resolve();
		await expect(pending).resolves.toEqual([0, 10, 20, 30]);
	});

	it("joins in-flight tasks before reporting a failure", async () => {
		const gate = deferred();
		const failure = new Error("failed");
		let settled = false;
		const pending = mapConcurrently([0, 1], 2, async (item) => {
			if (item === 0) throw failure;
			await gate.promise;
			return item;
		}).catch((error) => {
			settled = true;
			return error;
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		gate.resolve();
		await expect(pending).resolves.toBe(failure);
	});

	it("handles empty input and rejects invalid concurrency", async () => {
		const task = vi.fn();
		await expect(mapConcurrently([], 2, task)).resolves.toEqual([]);
		expect(task).not.toHaveBeenCalled();
		await expect(mapConcurrently([1], 0, task)).rejects.toThrow(RangeError);
	});
});
