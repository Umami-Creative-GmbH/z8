import { Effect } from "effect-v3";
import { describe, expect, it } from "vitest";
import { CompletedWorkCollisionError } from "@/lib/time-tracking/close-active-work";
import { approvalDbServiceForTransaction, translateLegacyCorrectionWorkError } from "./v3-boundary";

describe("approvals Effect v3 boundary", () => {
	// The legacy correction decision runs the finalizer inside an Effect v3 program.
	it("answers a collision an Effect v3 program wrapped as the typed conflict", async () => {
		const wrapped = await Effect.runPromise(Effect.die(new CompletedWorkCollisionError())).catch(
			(error: unknown) => error,
		);
		const other = await Effect.runPromise(Effect.die(new Error("internal"))).catch(
			(error: unknown) => error,
		);

		expect(translateLegacyCorrectionWorkError(wrapped)).toMatchObject({
			_tag: "ConflictError",
			conflictType: "completed_work_collision",
		});
		expect(translateLegacyCorrectionWorkError(other)).toBe(other);
	});

	it("runs approval queries against the client it was handed", async () => {
		const client = { marker: "tx" };
		const service = approvalDbServiceForTransaction({ db: client });

		expect(service.db).toBe(client);
		await expect(Effect.runPromise(service.query("read", async () => 42))).resolves.toBe(42);
	});
});
