import { describe, expect, it } from "vitest";
import {
	discordInvocationEnvelope,
	discordReceiverScope,
	encodeBoundApprovalCustomId,
	parseBoundApprovalCustomId,
} from "./bound-approval";

const bindingId = "b2920000-0000-4000-8000-000000000001";
const applicationId = "1122334455667788990";

describe("bound approval custom_id", () => {
	it("round-trips the binding handle within Discord's 100-character limit", () => {
		const approve = encodeBoundApprovalCustomId("approve", bindingId);
		const reject = encodeBoundApprovalCustomId("reject", bindingId);
		expect(approve.length).toBeLessThanOrEqual(100);
		expect(parseBoundApprovalCustomId(approve)).toEqual({ action: "approve", bindingId });
		expect(parseBoundApprovalCustomId(reject)).toEqual({ action: "reject", bindingId });
	});

	it("refuses anything that is not an exact bound action", () => {
		for (const bad of [
			JSON.stringify({ a: "ap", id: bindingId }),
			JSON.stringify({ a: "ba" }),
			JSON.stringify({ a: "ba", b: "not-a-uuid" }),
			JSON.stringify({ a: "br", b: bindingId, extra: 1 }),
			"resolved_approve",
			"{",
			"",
		]) {
			expect(parseBoundApprovalCustomId(bad)).toBeNull();
		}
	});

	it("never encodes an invalid binding handle", () => {
		expect(() => encodeBoundApprovalCustomId("approve", "not-a-uuid")).toThrow();
	});
});

describe("discord invocation envelope", () => {
	const interaction = {
		id: "1300000000000000001",
		application_id: applicationId,
		member: { user: { id: "4400000000000000001" } },
	};

	it("scopes the individual interaction ID to the authenticated application", () => {
		expect(discordReceiverScope(applicationId)).toBe(`discord-app:${applicationId}`);
		expect(discordInvocationEnvelope(applicationId, interaction)).toEqual({
			scheme: "discord_interaction",
			receiverScope: `discord-app:${applicationId}`,
			invocationId: "1300000000000000001",
			deliveryId: null,
			providerActorId: "4400000000000000001",
		});
		// A DM interaction carries the user at the top level.
		expect(
			discordInvocationEnvelope(applicationId, {
				id: interaction.id,
				application_id: applicationId,
				user: { id: "4400000000000000002" },
			}),
		).toMatchObject({ providerActorId: "4400000000000000002" });
	});

	it("has no identity for another application, a missing ID or an unknown actor", () => {
		expect(
			discordInvocationEnvelope(applicationId, {
				...interaction,
				application_id: "9999999999999999999",
			}),
		).toBeNull();
		expect(discordInvocationEnvelope("not-a-snowflake", interaction)).toBeNull();
		expect(discordInvocationEnvelope(applicationId, { ...interaction, id: "" })).toBeNull();
		expect(
			discordInvocationEnvelope(applicationId, { ...interaction, id: "abc-component" }),
		).toBeNull();
		expect(
			discordInvocationEnvelope(applicationId, {
				id: interaction.id,
				application_id: applicationId,
			}),
		).toBeNull();
	});
});
