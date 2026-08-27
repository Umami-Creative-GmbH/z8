import { describe, expect, it, vi } from "vitest";
import { createSCIMProjectionReplayLoader } from "./projection-replay-api";

describe("createSCIMProjectionReplayLoader", () => {
	it("replays only the requested organization through the trusted server API", async () => {
		const reconcileSCIMProjection = vi.fn(async () => ({
			provisioningDomainId: "org-1",
			reconciledUsers: 2,
			batches: 1,
		}));
		const loadReplay = createSCIMProjectionReplayLoader({
			reconcileSCIMProjection,
		});

		const replay = await loadReplay();
		await replay("org-1");

		expect(reconcileSCIMProjection).toHaveBeenCalledExactlyOnceWith({
			body: { provisioningDomainId: "org-1" },
		});
	});
});
