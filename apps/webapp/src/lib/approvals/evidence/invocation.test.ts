import { describe, expect, it } from "vitest";
import { ApprovalEvidenceError } from "./errors";
import {
	approvalInvocationIdempotencyKey,
	fingerprintApprovalInvocationCommand,
	parseApprovalInvocationIdentity,
} from "./invocation";

const identity = {
	organizationId: "org-1",
	scheme: "telegram_callback_query" as const,
	schemeVersion: 1 as const,
	receiverScope: "telegram-bot:123456",
	invocationId: "4382bfdwdsb323b2d9",
};

const command = {
	actorEmployeeId: "e0000000-0000-4000-8000-000000000001",
	actorUserId: "user-1",
	providerActorId: "777",
	reviewedBindingId: "b0000000-0000-4000-8000-000000000001",
	action: "approve" as const,
	reason: null,
};

describe("approval invocation identity", () => {
	it("derives a versioned receipt key from the exact provider identity only", () => {
		expect(approvalInvocationIdempotencyKey(identity)).toBe(
			"approval-invocation:v1:telegram_callback_query:19:telegram-bot:123456:18:4382bfdwdsb323b2d9",
		);
	});

	it("never lets a scope/ID split collide with another split", () => {
		const left = approvalInvocationIdempotencyKey({
			...identity,
			receiverScope: "a:1",
			invocationId: "2",
		});
		const right = approvalInvocationIdempotencyKey({
			...identity,
			receiverScope: "a",
			invocationId: "1:2",
		});
		expect(left).not.toBe(right);
	});

	it("keeps provider IDs opaque (no case folding or numeric coercion)", () => {
		expect(
			approvalInvocationIdempotencyKey({ ...identity, invocationId: "AbC" }),
		).not.toBe(
			approvalInvocationIdempotencyKey({ ...identity, invocationId: "abc" }),
		);
		expect(
			approvalInvocationIdempotencyKey({ ...identity, invocationId: "0012" }),
		).toContain(":4:0012");
	});

	it("refuses missing or unsupported identity instead of inventing one", () => {
		for (const bad of [
			{ ...identity, invocationId: "" },
			{ ...identity, invocationId: "  " },
			{ ...identity, receiverScope: "" },
			{ ...identity, organizationId: "" },
			{ ...identity, scheme: "slack_block_action" },
			{ ...identity, schemeVersion: 2 },
			{ ...identity, invocationId: 12 },
		]) {
			expect(() => parseApprovalInvocationIdentity(bad)).toThrow(
				ApprovalEvidenceError,
			);
		}
		expect(parseApprovalInvocationIdentity(identity)).toEqual(identity);
	});
});

describe("approval invocation command fingerprint", () => {
	it("is versioned separately from semantic workflow fingerprints", () => {
		expect(fingerprintApprovalInvocationCommand(command)).toMatch(
			/^approval-invocation-command:v1:[0-9a-f]{64}$/,
		);
	});

	it("binds actor, provider actor, reviewed binding, action and reason", () => {
		const base = fingerprintApprovalInvocationCommand(command);
		expect(fingerprintApprovalInvocationCommand({ ...command })).toBe(base);
		for (const changed of [
			{ ...command, actorEmployeeId: "e0000000-0000-4000-8000-000000000002" },
			{ ...command, actorUserId: "user-2" },
			{ ...command, providerActorId: "778" },
			{ ...command, reviewedBindingId: "b0000000-0000-4000-8000-000000000002" },
			{
				...command,
				action: "reject" as const,
				reason: "Rejected via Telegram",
			},
			{ ...command, reason: "" },
		]) {
			expect(fingerprintApprovalInvocationCommand(changed)).not.toBe(base);
		}
	});
});
