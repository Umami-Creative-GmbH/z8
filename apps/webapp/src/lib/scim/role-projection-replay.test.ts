import { Temporal } from "temporal-polyfill";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	SCIMProjectionRecoveryClaim,
	SCIMProjectionRecoveryStore,
} from "./projection-recovery";
import { retryDueSCIMProjectionRecovery } from "./projection-recovery";
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

function crashRecoveryStore() {
	let status: "idle" | "processing" | "completed" = "idle";
	const claim: SCIMProjectionRecoveryClaim = {
		id: "recovery_opaque",
		organizationId: "org_target",
		claimToken: "claim_opaque",
		attemptCount: 1,
	};
	const store: SCIMProjectionRecoveryStore = {
		begin: async () => {
			status = "processing";
			return claim;
		},
		claimDue: async (organizationId, now) => {
			if (
				status !== "processing" ||
				organizationId !== claim.organizationId ||
				!now ||
				Temporal.Instant.compare(
					now,
					Temporal.Instant.from("2026-08-25T00:05:00Z"),
				) < 0
			)
				return null;
			return claim;
		},
		complete: async () => {
			status = "completed";
		},
		defer: async () => undefined,
	};
	return { store, status: () => status };
}

function concurrentRecoveryStore() {
	const intents: Array<SCIMProjectionRecoveryClaim & { status: string }> = [];
	const store: SCIMProjectionRecoveryStore = {
		begin: async (organizationId) => {
			const number = intents.length + 1;
			const intent = {
				id: `intent_${number}`,
				organizationId,
				claimToken: `claim_${number}`,
				attemptCount: 1,
				status: "processing",
			};
			intents.push(intent);
			return intent;
		},
		claimDue: async (organizationId) => {
			const intent = intents.find(
				(candidate) =>
					candidate.organizationId === organizationId &&
					candidate.status === "processing",
			);
			if (!intent) return null;
			intent.claimToken = `retry_${intent.id}`;
			intent.attemptCount += 1;
			return { ...intent };
		},
		complete: async (claim) => {
			const intent = intents.find(
				(candidate) =>
					candidate.id === claim.id &&
					candidate.organizationId === claim.organizationId &&
					candidate.claimToken === claim.claimToken &&
					candidate.status === "processing",
			);
			if (!intent)
				throw new Error("SCIM projection recovery lease is no longer owned");
			intent.status = "completed";
		},
		defer: async () => undefined,
	};
	return { intents, store };
}

function waitForever(): Promise<never> {
	return new Promise(() => undefined);
}

describe("SCIM projection replay boundary", () => {
	it("requests SCIM mapping replay only after persistence", async () => {
		const order: string[] = [];
		configureSCIMProjectionReplay(async () => {
			order.push("preflight");
			return async (organizationId) => {
				order.push(`replay:${organizationId}`);
			};
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
		expect(order).toEqual([
			"preflight",
			"begin:org_target",
			"persist",
			"replay:org_target",
			"complete",
		]);
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

		expect(order).toEqual([
			"begin:org_target",
			"delete-assignment",
			"replay:org_target",
			"complete",
		]);
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

	it("completes the intent when mutation fails before changing policy", async () => {
		const events: string[] = [];
		const mutationError = new Error("mutation rejected");
		const replay = vi.fn();
		configureSCIMProjectionReplay(async () => replay);

		await expect(
			requestSCIMProjectionReplayAfter(
				{ organizationId: "org_target", source: "manual" },
				async () => {
					events.push("persist");
					throw mutationError;
				},
				vi.fn(),
				recoveryStore(events),
			),
		).rejects.toBe(mutationError);
		expect(events).toEqual(["begin:org_target", "persist", "complete"]);
		expect(replay).not.toHaveBeenCalled();
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
			"begin:org_target",
			"restore",
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
		expect(events).toEqual(["begin:org_target", "restore", "defer"]);
	});

	it("leaves a due intent when the process terminates before mutation", async () => {
		const recovery = crashRecoveryStore();
		let mutationStarted: (() => void) | undefined;
		const mutationEntered = new Promise<void>((resolve) => {
			mutationStarted = resolve;
		});
		const initialReplay = vi.fn();
		configureSCIMProjectionReplay(async () => initialReplay);

		void requestSCIMProjectionReplayAfter(
			{ organizationId: "org_target", source: "manual" },
			async () => {
				mutationStarted?.();
				return waitForever();
			},
			vi.fn(),
			recovery.store,
		);
		await mutationEntered;

		expect(recovery.status()).toBe("processing");
		expect(initialReplay).not.toHaveBeenCalled();
		const replayCommittedPolicy = vi.fn().mockResolvedValue(undefined);
		await expect(
			retryDueSCIMProjectionRecovery({
				organizationId: "org_target",
				store: recovery.store,
				replay: replayCommittedPolicy,
				now: Temporal.Instant.from("2026-08-25T00:05:01Z"),
			}),
		).resolves.toBe(true);
		expect(replayCommittedPolicy).toHaveBeenCalledWith("org_target");
		expect(recovery.status()).toBe("completed");
	});

	it("retries a due intent after termination during the initial replay", async () => {
		const recovery = crashRecoveryStore();
		let replayStarted: (() => void) | undefined;
		const replayEntered = new Promise<void>((resolve) => {
			replayStarted = resolve;
		});
		let policy = "before";
		let projectedPolicy = "before";
		configureSCIMProjectionReplay(async () => async () => {
			projectedPolicy = "partial";
			replayStarted?.();
			return waitForever();
		});

		void requestSCIMProjectionReplayAfter(
			{ organizationId: "org_target", source: "scim" },
			async () => {
				policy = "changed";
				return "before";
			},
			async (snapshot) => {
				policy = snapshot;
			},
			recovery.store,
		);
		await replayEntered;

		expect(recovery.status()).toBe("processing");
		expect(projectedPolicy).toBe("partial");
		await retryDueSCIMProjectionRecovery({
			organizationId: "org_target",
			store: recovery.store,
			replay: async () => {
				projectedPolicy = policy;
			},
			now: Temporal.Instant.from("2026-08-25T00:05:01Z"),
		});
		expect(projectedPolicy).toBe("changed");
		expect(recovery.status()).toBe("completed");
	});

	it.each(["failure", "success"] as const)(
		"keeps crashed intent A due when mutation B ends in %s",
		async (outcome) => {
			const recovery = concurrentRecoveryStore();
			await recovery.store.begin("org_target");
			let policy = "before";
			let projectedPolicy = "stale";
			configureSCIMProjectionReplay(async () => async () => {
				projectedPolicy = policy;
			});

			const mutationB = requestSCIMProjectionReplayAfter(
				{ organizationId: "org_target", source: "manual" },
				async () => {
					if (outcome === "failure") throw new Error("mutation B rejected");
					policy = "changed-by-b";
					return "before";
				},
				async (snapshot) => {
					policy = snapshot;
				},
				recovery.store,
			);
			if (outcome === "failure") {
				await expect(mutationB).rejects.toThrow("mutation B rejected");
			} else {
				await expect(mutationB).resolves.toBe("before");
			}

			expect(recovery.intents).toMatchObject([
				{ id: "intent_1", status: "processing" },
				{ id: "intent_2", status: "completed" },
			]);
			await retryDueSCIMProjectionRecovery({
				organizationId: "org_target",
				store: recovery.store,
				replay: async () => {
					projectedPolicy = policy;
				},
			});
			expect(projectedPolicy).toBe(
				outcome === "failure" ? "before" : "changed-by-b",
			);
			expect(recovery.intents[0]?.status).toBe("completed");
		},
	);
});
