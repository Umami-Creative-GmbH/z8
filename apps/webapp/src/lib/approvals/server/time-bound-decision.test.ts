import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
		SCIM_CREDENTIAL_HASH_SECRET: "test-scim-credential-hash-secret-value",
		S3_PUBLIC_BUCKET: "test-bucket",
		S3_PUBLIC_ACCESS_KEY_ID: "test-access-key",
		S3_PUBLIC_SECRET_ACCESS_KEY: "test-secret-key",
		S3_PUBLIC_ENDPOINT: "https://example.com",
		S3_PUBLIC_URL: "https://example.com",
		S3_PUBLIC_REGION: "us-east-1",
		S3_PUBLIC_FORCE_PATH_STYLE: "true",
		NODE_ENV: "test",
	},
}));

// Card decisions against real owners are verified against PostgreSQL in
// telegram/legacy-time-bound-approval.integration.test.ts.
const findCommittedInvocationDecision = vi.hoisted(() => vi.fn());
vi.mock("../evidence/invocation", async (importOriginal) => ({
	...(await importOriginal<typeof import("../evidence/invocation")>()),
	findCommittedInvocationDecision,
}));

import { AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { decideBoundLegacyTimeInvocation } from "./time-bound-decision";

describe("bound legacy time decisions under Effect v4", () => {
	it.each([
		["AuthorizationError", () => new AuthorizationError({ message: "Not the approver" })],
		["ValidationError", () => new ValidationError({ message: "No longer a time request" })],
	])("reads a %s that Effect.runPromise rejected with as a stale card", async (_name, refusal) => {
		// Effect v4 runPromise rejects with the owner's refusal itself.
		const rejection = await Effect.runPromise(Effect.fail(refusal())).then(
			() => null,
			(error: unknown) => error,
		);
		findCommittedInvocationDecision.mockRejectedValueOnce(rejection);

		const result = await decideBoundLegacyTimeInvocation({
			database: {} as never,
			organizationId: "org-1",
			actorEmployeeId: "manager-1",
			actorUserId: "manager-user-1",
			bindingId: "binding-1",
			action: "approve",
			invocation: {
				identity: { provider: "telegram", invocationId: "update-1" },
				providerActorId: "provider-actor-1",
			} as never,
		});

		expect(result).toEqual({ status: "review_required", reason: "stale" });
	});
});
