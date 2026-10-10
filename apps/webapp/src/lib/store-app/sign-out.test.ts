import { afterEach, describe, expect, it, vi } from "vitest";
import { onStoreAppSignOut, runStoreAppSignOutTasks } from "./sign-out";

const unsubscribers: Array<() => void> = [];
function register(task: () => Promise<void> | void) {
	unsubscribers.push(onStoreAppSignOut(task));
}

afterEach(() => {
	for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
	vi.useRealTimers();
});

describe("store app sign-out tasks", () => {
	it("runs every registered task while the session still exists", async () => {
		const order: string[] = [];
		register(async () => void order.push("remove device token"));
		register(() => void order.push("forget device"));

		await runStoreAppSignOutTasks();
		order.push("sign out");

		expect(order).toEqual(["remove device token", "forget device", "sign out"]);
	});

	it("still signs out when a task fails", async () => {
		const later = vi.fn();
		register(async () => {
			throw new Error("Network down");
		});
		register(later);

		await expect(runStoreAppSignOutTasks()).resolves.toBeUndefined();
		expect(later).toHaveBeenCalledOnce();
	});

	it("does not let a hanging task hold sign-out", async () => {
		vi.useFakeTimers();
		register(() => new Promise<void>(() => {}));

		const done = vi.fn();
		void runStoreAppSignOutTasks().then(done);
		await vi.advanceTimersByTimeAsync(5_000);

		expect(done).toHaveBeenCalledOnce();
	});

	it("stops running a task once it is unregistered", async () => {
		const task = vi.fn();
		const unsubscribe = onStoreAppSignOut(task);
		unsubscribe();

		await runStoreAppSignOutTasks();

		expect(task).not.toHaveBeenCalled();
	});
});
