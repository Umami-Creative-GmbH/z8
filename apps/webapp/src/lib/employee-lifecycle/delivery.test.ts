import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { DepartureTaskNeedsResolutionError, runDepartureTaskDelivery } from "./delivery";
import type { DepartureTaskClaim, DepartureTaskOutbox } from "./outbox";
import { createSessionRevocationHandler } from "./session-cleanup";

const NOW = parseInstant("2026-09-15T00:00:00Z");

function claim(overrides: Partial<DepartureTaskClaim>): DepartureTaskClaim {
	return {
		id: "task-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		employmentPeriodId: "period-1",
		departureId: "departure-1",
		kind: "session_revocation",
		payload: {},
		claimToken: "claim-1",
		attemptCount: 1,
		...overrides,
	};
}

function fakeOutbox(claims: DepartureTaskClaim[]) {
	return {
		claimDue: vi.fn().mockResolvedValue(claims),
		complete: vi.fn().mockResolvedValue(undefined),
		defer: vi.fn().mockResolvedValue("deferred"),
		recordProgress: vi.fn().mockResolvedValue(undefined),
	} satisfies DepartureTaskOutbox;
}

describe("runDepartureTaskDelivery", () => {
	it("completes handled work, defers failures and fails unsupported kinds terminally", async () => {
		const outbox = fakeOutbox([
			claim({ id: "ok", kind: "clock_repair" }),
			claim({ id: "flaky", kind: "billing_sync" }),
			claim({ id: "unknown", kind: "approval_handover" }),
		]);
		const failure = new Error("stripe timeout");

		const result = await runDepartureTaskDelivery({
			outbox,
			now: NOW,
			handlers: {
				clock_repair: vi.fn().mockResolvedValue(undefined),
				billing_sync: vi.fn().mockRejectedValue(failure),
			},
		});

		expect(result).toEqual({ claimed: 3, completed: 1, deferred: 1, failed: 1 });
		expect(outbox.complete).toHaveBeenCalledWith(expect.objectContaining({ id: "ok" }), NOW, {
			clearPayload: false,
		});
		expect(outbox.defer).toHaveBeenCalledWith(
			expect.objectContaining({ id: "flaky" }),
			NOW,
			failure,
			{ terminal: false },
		);
		expect(outbox.defer).toHaveBeenCalledWith(
			expect.objectContaining({ id: "unknown" }),
			NOW,
			expect.objectContaining({ message: "unsupported_departure_task_kind" }),
			{ terminal: true },
		);
	});

	it("fails a task terminally when its handler needs admin resolution", async () => {
		const outbox = fakeOutbox([claim({ id: "handover", kind: "approval_handover" })]);
		outbox.defer.mockResolvedValue("failed");
		const needsAdmin = new DepartureTaskNeedsResolutionError("no_replacement");

		const result = await runDepartureTaskDelivery({
			outbox,
			now: NOW,
			handlers: { approval_handover: vi.fn().mockRejectedValue(needsAdmin) },
		});

		expect(result).toEqual({ claimed: 1, completed: 0, deferred: 0, failed: 1 });
		expect(outbox.defer).toHaveBeenCalledWith(expect.anything(), NOW, needsAdmin, {
			terminal: true,
		});
	});

	it("clears the private token payload after session cleanup succeeds", async () => {
		const outbox = fakeOutbox([claim({ kind: "session_revocation", payload: { tokens: ["t"] } })]);

		await runDepartureTaskDelivery({
			outbox,
			now: NOW,
			handlers: { session_revocation: vi.fn().mockResolvedValue(undefined) },
		});

		expect(outbox.complete).toHaveBeenCalledWith(expect.anything(), NOW, { clearPayload: true });
	});
});

describe("createSessionRevocationHandler", () => {
	it("deletes exactly the departed sessions captured at departure", async () => {
		const deleteSecondarySession = vi.fn().mockResolvedValue(undefined);
		const handle = createSessionRevocationHandler(deleteSecondarySession);

		await handle(claim({ payload: { tokens: ["old-a", "old-b"] } }));

		expect(deleteSecondarySession.mock.calls).toEqual([["old-a"], ["old-b"]]);
	});

	it("rejects a malformed payload instead of guessing which sessions to revoke", async () => {
		const handle = createSessionRevocationHandler(vi.fn());

		await expect(handle(claim({ payload: { userId: "user-1" } }))).rejects.toThrow(
			"invalid_session_revocation_payload",
		);
	});
});
