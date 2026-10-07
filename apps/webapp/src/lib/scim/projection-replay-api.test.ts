import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BetterAuthError } from "@better-auth/core/error";
import { describe, expect, it, vi } from "vitest";
import {
	createSCIMProjectionReplayLoader,
	isSCIMProjectionSubjectConflict,
	SCIM_PROJECTION_REPLAY_ATTEMPTS,
	SCIM_PROJECTION_SUBJECT_CONFLICT_MESSAGE,
} from "./projection-replay-api";

function subjectConflict() {
	return new BetterAuthError(SCIM_PROJECTION_SUBJECT_CONFLICT_MESSAGE);
}

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

	it("retries a replay that lost the subject revision race and succeeds on a later attempt", async () => {
		const reconcileSCIMProjection = vi
			.fn<() => Promise<unknown>>()
			.mockRejectedValueOnce(subjectConflict())
			.mockRejectedValueOnce(subjectConflict())
			.mockResolvedValueOnce({ provisioningDomainId: "org-1" });
		const replay = await createSCIMProjectionReplayLoader({ reconcileSCIMProjection })();

		await replay("org-1");

		expect(reconcileSCIMProjection).toHaveBeenCalledTimes(3);
		for (const call of reconcileSCIMProjection.mock.calls) {
			expect(call).toEqual([{ body: { provisioningDomainId: "org-1" } }]);
		}
	});

	it("gives up after the attempt cap and rethrows the last subject conflict", async () => {
		const conflicts = Array.from({ length: SCIM_PROJECTION_REPLAY_ATTEMPTS }, subjectConflict);
		const reconcileSCIMProjection = vi.fn<() => Promise<unknown>>();
		for (const conflict of conflicts) {
			reconcileSCIMProjection.mockRejectedValueOnce(conflict);
		}
		const replay = await createSCIMProjectionReplayLoader({ reconcileSCIMProjection })();

		await expect(replay("org-1")).rejects.toBe(conflicts.at(-1));
		expect(SCIM_PROJECTION_REPLAY_ATTEMPTS).toBe(3);
		expect(reconcileSCIMProjection).toHaveBeenCalledTimes(3);
	});

	it.each([
		["a callback failure", new Error("projection callback failed")],
		[
			"a decommission conflict",
			new BetterAuthError('SCIM connection "conn-1" decommission checkpoint changed concurrently.'),
		],
		[
			"a guard order error",
			Object.assign(new Error("SCIM projection subjects were acquired out of order"), {
				name: "SCIMProjectionGuardOrderError",
			}),
		],
		[
			"a plain error carrying the conflict message",
			new Error(SCIM_PROJECTION_SUBJECT_CONFLICT_MESSAGE),
		],
	])("does not retry %s", async (_label, error) => {
		const reconcileSCIMProjection = vi.fn<() => Promise<unknown>>().mockRejectedValue(error);
		const replay = await createSCIMProjectionReplayLoader({ reconcileSCIMProjection })();

		await expect(replay("org-1")).rejects.toBe(error);
		expect(reconcileSCIMProjection).toHaveBeenCalledOnce();
	});
});

describe("isSCIMProjectionSubjectConflict", () => {
	it("matches only the Better Auth subject conflict error", () => {
		expect(isSCIMProjectionSubjectConflict(subjectConflict())).toBe(true);
		expect(isSCIMProjectionSubjectConflict(new BetterAuthError("other"))).toBe(false);
		expect(
			isSCIMProjectionSubjectConflict(new Error(SCIM_PROJECTION_SUBJECT_CONFLICT_MESSAGE)),
		).toBe(false);
		expect(isSCIMProjectionSubjectConflict(SCIM_PROJECTION_SUBJECT_CONFLICT_MESSAGE)).toBe(false);
	});

	it("pins the message the installed @better-auth/scim throws for a subject conflict", async () => {
		// The upstream predicate is module-private, so the replayer matches the message.
		// If Better Auth rewords it, this fails instead of silently disabling the retry.
		const source = await readFile(fileURLToPath(import.meta.resolve("@better-auth/scim")), "utf8");

		expect(source).toContain(
			`new BetterAuthError(${JSON.stringify(SCIM_PROJECTION_SUBJECT_CONFLICT_MESSAGE)})`,
		);
		expect(SCIM_PROJECTION_SUBJECT_CONFLICT_MESSAGE).toBe(
			"The SCIM projection subject changed concurrently; retry the request.",
		);
	});
});
