import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("preservation-only browser sync", () => {
	it.each([
		{
			id: "local-only",
			type: "clock_in",
			organizationId: "original-org",
			workLocationType: "field",
		},
		{
			id: "local-only",
			type: "clock_out",
			browserTimezone: null,
			retryCount: 5,
		},
		{
			id: "local-only",
			type: "clock_in",
			browserTimezone: "Europe/Berlin",
			location: { latitude: 1 },
		},
		{
			id: "local-only",
			type: "clock_out",
			recovery: {
				state: "review_required",
				reason: "conflict",
				commitment: "unknown",
			},
		},
	])(
		"does not convert incomplete legacy evidence into a new server command: %j",
		async (record) => {
			const original = structuredClone(record);
			const fetch = vi.fn();
			const context = vm.createContext({
				fetch,
				self: {
					OfflineQueueDB: {
						retainForReview: vi.fn(),
						getPending: async () => [record],
					},
				},
			});
			vm.runInContext(
				readFileSync(resolve("public/lib/sync-service.js"), "utf8"),
				context,
			);
			const result = await vm.runInContext(
				"self.SyncService.processQueue()",
				context,
			);
			expect(result).toMatchObject({
				successCount: 0,
				reviewCount: 1,
				retryPending: false,
			});
			expect(fetch).not.toHaveBeenCalled();
			expect(record).toEqual(original);
		},
	);
});
