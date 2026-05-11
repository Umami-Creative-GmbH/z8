import { describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";
import { DatabaseService } from "./database.service";
import { ChangePolicyService, ChangePolicyServiceLive } from "./change-policy.service";

describe("ChangePolicyService", () => {
	it("does not require approval for a normal live clock-out", async () => {
		const db = {
			query: {
				employee: {
					findFirst: vi.fn().mockResolvedValue({
						id: "employee-1",
						teamId: null,
						organizationId: "org-1",
					}),
				},
				changePolicyAssignment: {
					findFirst: vi.fn().mockResolvedValue({
						id: "assignment-1",
						policy: {
							id: "policy-1",
							name: "No self-service edits",
							selfServiceDays: 0,
							approvalDays: 30,
							noApprovalRequired: false,
							notifyAllManagers: false,
							isActive: true,
						},
					}),
				},
			},
		};
		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: db as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);
		const layer = ChangePolicyServiceLive.pipe(Layer.provide(dbLayer));

		const needsApproval = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* ChangePolicyService;
				return yield* service.checkClockOutNeedsApproval("employee-1");
			}).pipe(Effect.provide(layer)),
		);

		expect(needsApproval).toBe(false);
	});
});
