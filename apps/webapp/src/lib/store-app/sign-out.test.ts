import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	removeNativePushTokenBeforeSignOut: vi.fn(async () => undefined),
	signOut: vi.fn(async (..._args: unknown[]) => ({ data: { success: true }, error: null })),
}));
vi.mock("./native-push", () => ({
	removeNativePushTokenBeforeSignOut: mocks.removeNativePushTokenBeforeSignOut,
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: mocks.signOut } }));

import { signOut } from "./sign-out";

beforeEach(() => {
	mocks.removeNativePushTokenBeforeSignOut.mockReset().mockResolvedValue(undefined);
	mocks.signOut.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("signOut", () => {
	it("removes this device's push token (#843) while the session still exists", async () => {
		const order: string[] = [];
		mocks.removeNativePushTokenBeforeSignOut.mockImplementationOnce(async () => {
			order.push("remove push token");
		});
		mocks.signOut.mockImplementationOnce(async () => {
			order.push("sign out");
			return { data: { success: true }, error: null };
		});

		await signOut();

		expect(order).toEqual(["remove push token", "sign out"]);
	});

	it("passes its options through to Better Auth", async () => {
		const onSuccess = vi.fn();

		await signOut({ fetchOptions: { onSuccess } });

		expect(mocks.signOut).toHaveBeenCalledWith({ fetchOptions: { onSuccess } });
	});

	it("still signs out when the device cleanup fails", async () => {
		mocks.removeNativePushTokenBeforeSignOut.mockRejectedValueOnce(new Error("Network down"));

		await signOut();

		expect(mocks.signOut).toHaveBeenCalledOnce();
	});

	it("does not let a hanging device cleanup hold sign-out", async () => {
		vi.useFakeTimers();
		mocks.removeNativePushTokenBeforeSignOut.mockImplementationOnce(() => new Promise(() => {}));

		const done = vi.fn();
		void signOut().then(done);
		await vi.advanceTimersByTimeAsync(3_000);

		expect(mocks.signOut).toHaveBeenCalledOnce();
		expect(done).toHaveBeenCalledOnce();
	});
});
