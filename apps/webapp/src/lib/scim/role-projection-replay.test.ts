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
		);

		expect(order).toEqual(["delete-assignment", "replay:org_target"]);
	});

	it("fails closed when replay-required persistence has no registered integration", async () => {
		await expect(
			requestSCIMProjectionReplayAfter(
				{ organizationId: "org_target", source: "scim" },
				async () => undefined,
			),
		).rejects.toThrow("SCIM projection replay is not configured");
	});
});
