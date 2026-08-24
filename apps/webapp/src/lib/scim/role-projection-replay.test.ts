import { afterEach, describe, expect, it, vi } from "vitest";
import {
	configureSCIMProjectionReplay,
	requestSCIMProjectionReplayAfter,
} from "./role-projection-replay";

afterEach(() => configureSCIMProjectionReplay(null));

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
			),
		).rejects.toThrow("SCIM projection replay is not configured");
		expect(persist).not.toHaveBeenCalled();
	});

	it("compensates a rejected replay and preserves the original policy", async () => {
		let policy = "before";
		const replayError = new Error("replay rejected");
		configureSCIMProjectionReplay(async () => async () => {
			throw replayError;
		});

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
			),
		).rejects.toBe(replayError);
		expect(policy).toBe("before");
	});
});
