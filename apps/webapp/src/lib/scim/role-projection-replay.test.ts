import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	SCIMProjectionRecoveryClaim,
	SCIMProjectionRecoveryStore,
} from "./projection-recovery";
import {
	configureSCIMProjectionReplay,
	requestSCIMProjectionReplayAfter,
} from "./role-projection-replay";

afterEach(() => configureSCIMProjectionReplay(null));

function recoveryStore(events: string[] = []): SCIMProjectionRecoveryStore {
	const claim: SCIMProjectionRecoveryClaim = {
		id: "recovery_opaque",
		organizationId: "org_target",
		claimToken: "claim_opaque",
		attemptCount: 1,
	};
	return {
		begin: async (organizationId) => {
			events.push(`begin:${organizationId}`);
			return claim;
		},
		claimDue: async () => null,
		complete: async () => {
			events.push("complete");
		},
		defer: async () => {
			events.push("defer");
		},
	};
}

describe("SCIM projection replay boundary", () => {
	it("requests SCIM mapping replay only after persistence", async () => {
		const order: string[] = [];
		configureSCIMProjectionReplay(async () => (organizationId) => {
			order.push(`replay:${organizationId}`);
		});

		const result = await requestSCIMProjectionReplayAfter(
			{ organizationId: "org_target", source: "scim" },
			async () => {
				order.push("persist");
				return "created";
			},
			async () => {
				order.push("compensate");
			},
			recoveryStore(order),
		);

		expect(result).toBe("created");
		expect(order).toEqual(["persist", "replay:org_target"]);
	});

	it("does not replay SSO mappings", async () => {
		const replay = vi.fn();
		configureSCIMProjectionReplay(async () => replay);

		await requestSCIMProjectionReplayAfter(
			{ organizationId: "org_target", source: "sso" },
			async () => undefined,
		);

		expect(replay).not.toHaveBeenCalled();
	});

	it("replays after a manual assignment removal", async () => {
		const order: string[] = [];
		configureSCIMProjectionReplay(async () => (organizationId) => {
			order.push(`replay:${organizationId}`);
		});

		await requestSCIMProjectionReplayAfter(
			{ organizationId: "org_target", source: "manual" },
			async () => {
				order.push("delete-assignment");
			},
			async () => {
				order.push("restore-assignment");
			},
			recoveryStore(order),
		);

		expect(order).toEqual(["delete-assignment", "replay:org_target"]);
	});

	it("fails closed when replay-required persistence has no registered integration", async () => {
		const persist = vi.fn();
		await expect(
			requestSCIMProjectionReplayAfter(
				{ organizationId: "org_target", source: "scim" },
				persist,
				vi.fn(),
				recoveryStore(),
			),
		).rejects.toThrow("SCIM projection replay is not configured");
		expect(persist).not.toHaveBeenCalled();
	});

	it("fails closed before persistence when durable recovery is unavailable", async () => {
		const persist = vi.fn();
		configureSCIMProjectionReplay(async () => vi.fn());

		await expect(
			requestSCIMProjectionReplayAfter(
				{ organizationId: "org_target", source: "manual" },
				persist,
				vi.fn(),
			),
		).rejects.toThrow("SCIM projection replay is not configured");
		expect(persist).not.toHaveBeenCalled();
	});

	it("compensates a rejected replay and preserves the original policy", async () => {
		let policy = "before";
		const replayError = new Error("replay rejected");
		const replay = vi.fn().mockRejectedValueOnce(replayError);
		configureSCIMProjectionReplay(async () => replay);

		await expect(
			requestSCIMProjectionReplayAfter(
				{ organizationId: "org_target", source: "manual" },
				async () => {
					const snapshot = policy;
					policy = "deleted";
					return snapshot;
				},
				async (snapshot) => {
					policy = snapshot;
				},
				recoveryStore(),
			),
		).rejects.toBe(replayError);
		expect(policy).toBe("before");
	});

	it("recovers partial user effects by replaying the restored policy", async () => {
		const events: string[] = [];
		let policy = "before";
		let partialUserEffect = false;
		let replayCount = 0;
		configureSCIMProjectionReplay(async () => async () => {
			replayCount += 1;
			if (replayCount === 1) {
				partialUserEffect = true;
				throw new Error("partial replay");
			}
			events.push(`replay:${policy}`);
			partialUserEffect = false;
		});

		await expect(
			requestSCIMProjectionReplayAfter(
				{ organizationId: "org_target", source: "scim" },
				async () => {
					const snapshot = policy;
					policy = "changed";
					return snapshot;
				},
				async (snapshot) => {
					policy = snapshot;
					events.push("restore");
				},
				recoveryStore(events),
			),
		).rejects.toThrow("partial replay");
		expect(events).toEqual([
			"restore",
			"begin:org_target",
			"replay:before",
			"complete",
		]);
		expect(partialUserEffect).toBe(false);
	});

	it("leaves durable recovery pending when compensating replay also fails", async () => {
		const events: string[] = [];
		configureSCIMProjectionReplay(async () => async () => {
			throw new Error("replay failed");
		});

		const error = await requestSCIMProjectionReplayAfter(
			{ organizationId: "org_target", source: "manual" },
			async () => "snapshot",
			async () => {
				events.push("restore");
			},
			recoveryStore(events),
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(AggregateError);
		expect((error as AggregateError).errors).toHaveLength(2);
		expect(events).toEqual(["restore", "begin:org_target", "defer"]);
	});
});
