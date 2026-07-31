import { describe, expect, it, vi } from "vitest";
import { runOnboardingAction } from "./run-onboarding-action";

describe("runOnboardingAction", () => {
	it("keeps loading latched when the result callback returns true", async () => {
		const action = vi.fn().mockResolvedValue("result");
		const onResult = vi.fn(() => true);
		const onRejected = vi.fn();
		const setLoading = vi.fn();

		await runOnboardingAction({ action, onRejected, onResult, setLoading });

		expect(action).toHaveBeenCalledOnce();
		expect(onResult).toHaveBeenCalledOnce();
		expect(onRejected).not.toHaveBeenCalled();
		expect(setLoading.mock.calls).toEqual([[true]]);
	});

	it("resets loading after a resolved non-navigation result", async () => {
		const events: string[] = [];
		const action = vi.fn(async () => {
			events.push("action");
			return "result";
		});
		const onResult = vi.fn((result: string) => {
			events.push(`result:${result}`);
		});
		const onRejected = vi.fn(() => {
			events.push("rejected");
		});
		const setLoading = vi.fn((loading: boolean) => {
			events.push(`loading:${loading}`);
		});

		await runOnboardingAction({ action, onRejected, onResult, setLoading });

		expect(events).toEqual([
			"loading:true",
			"action",
			"result:result",
			"loading:false",
		]);
		expect(action).toHaveBeenCalledOnce();
		expect(onResult).toHaveBeenCalledOnce();
		expect(onResult).toHaveBeenCalledWith("result");
		expect(onRejected).not.toHaveBeenCalled();
		expect(setLoading).toHaveBeenCalledTimes(2);
	});

	it("dispatches an action rejection exactly once between loading states", async () => {
		const events: string[] = [];
		const action = vi.fn(async () => {
			events.push("action");
			throw new Error("action failed");
		});
		const onResult = vi.fn(() => {
			events.push("result");
		});
		const onRejected = vi.fn(() => {
			events.push("rejected");
		});
		const setLoading = vi.fn((loading: boolean) => {
			events.push(`loading:${loading}`);
		});

		await runOnboardingAction({ action, onRejected, onResult, setLoading });

		expect(events).toEqual([
			"loading:true",
			"action",
			"rejected",
			"loading:false",
		]);
		expect(action).toHaveBeenCalledOnce();
		expect(onResult).not.toHaveBeenCalled();
		expect(onRejected).toHaveBeenCalledOnce();
		expect(setLoading).toHaveBeenCalledTimes(2);
	});

	it("propagates a result callback error without invoking the rejection callback", async () => {
		const callbackError = new Error("result callback failed");
		const action = vi.fn().mockResolvedValue("result");
		const onResult = vi.fn(() => {
			throw callbackError;
		});
		const onRejected = vi.fn();
		const setLoading = vi.fn();

		await expect(
			runOnboardingAction({ action, onRejected, onResult, setLoading }),
		).rejects.toBe(callbackError);

		expect(action).toHaveBeenCalledOnce();
		expect(onResult).toHaveBeenCalledOnce();
		expect(onRejected).not.toHaveBeenCalled();
		expect(setLoading.mock.calls).toEqual([[true], [false]]);
	});

	it("propagates a rejection callback error after resetting loading", async () => {
		const callbackError = new Error("rejection callback failed");
		const action = vi.fn().mockRejectedValue(new Error("action failed"));
		const onResult = vi.fn();
		const onRejected = vi.fn(() => {
			throw callbackError;
		});
		const setLoading = vi.fn();

		await expect(
			runOnboardingAction({ action, onRejected, onResult, setLoading }),
		).rejects.toBe(callbackError);

		expect(action).toHaveBeenCalledOnce();
		expect(onResult).not.toHaveBeenCalled();
		expect(onRejected).toHaveBeenCalledOnce();
		expect(setLoading.mock.calls).toEqual([[true], [false]]);
	});
});
