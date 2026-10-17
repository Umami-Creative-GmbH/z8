import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { evaluateOrganizationMfaAccess, type LocalMfaProof } from "./access";

const session = { id: "session", userId: "member" };
const proof: LocalMfaProof = {
	sessionId: "session",
	userId: "member",
	method: "totp",
	factorId: "factor",
	verifiedAt: "2026-10-24T01:30:00Z",
};
const input = {
	enabled: true,
	deadline: "2026-10-25T01:30:00Z",
	now: Temporal.Instant.from("2026-10-25T01:30:00Z"),
	session,
	localProof: null,
	ssoExempt: false,
};

describe("organization local MFA access", () => {
	it("requires a verified session at the exact assigned deadline", () => {
		expect(evaluateOrganizationMfaAccess(input)).toEqual({
			allowed: false,
			reason: "MFA_REQUIRED",
			deadline: "2026-10-25T01:30:00Z",
		});
	});
	it.each([
		[{ enabled: false }, "disabled"],
		[{ now: Temporal.Instant.from("2026-10-25T01:29:59.999Z") }, "grace"],
		[{ localProof: proof }, "local"],
		[{ localProof: { ...proof, method: "passkey" } }, "local"],
		[{ ssoExempt: true }, "sso"],
	])("permits the applicable access route %j", (override, reason) => {
		expect(evaluateOrganizationMfaAccess({ ...input, ...override })).toEqual({
			allowed: true,
			reason,
		});
	});
	it.each([
		{ session: null },
		{ localProof: { ...proof, userId: "other" } },
		{ localProof: { ...proof, sessionId: "other" } },
		{ localProof: { ...proof, verifiedAt: "2026-10-25T02:30:00Z" } },
		{ localProof: proof, session: { ...session, impersonatedBy: "operator" } },
		{ ssoExempt: true, session: { ...session, impersonatedBy: "operator" } },
		{ deadline: null },
	])("fails closed without authentic evidence %j", (override) => {
		expect(
			evaluateOrganizationMfaAccess({ ...input, ...override }).allowed,
		).toBe(false);
	});
});
it("records qualifying authentication during grace rather than conflating it with enrollment", () => {
	expect(
		evaluateOrganizationMfaAccess({
			...input,
			now: Temporal.Instant.from("2026-10-24T02:00:00Z"),
			localProof: proof,
		}),
	).toEqual({ allowed: true, reason: "local" });
});
