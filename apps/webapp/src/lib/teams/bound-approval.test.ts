import { describe, expect, it } from "vitest";
import {
	parseTeamsBoundApprovalInvoke,
	TEAMS_APPROVAL_VERBS,
	teamsBoundActionData,
	teamsInvocationEnvelope,
	teamsReceiverScope,
} from "./bound-approval";

const APP_ID = "0b1f5a3e-2c4d-4e6f-8a9b-0c1d2e3f4a5b";
const TENANT_ID = "7d2c1b0a-9e8f-4a6b-8c5d-4e3f2a1b0c9d";
const BINDING_ID = "3f0e4c1a-7b2d-4e9f-8a6c-5d1b2e3f4a70";
const AAD_OBJECT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

function executeInvoke(overrides: Record<string, unknown> = {}) {
	return {
		type: "invoke",
		name: "adaptiveCard/action",
		id: "f:1234567890123456789",
		channelId: "msteams",
		replyToId: "1790000000000",
		recipient: { id: `28:${APP_ID}` },
		from: { id: "29:opaque-user", aadObjectId: AAD_OBJECT_ID },
		conversation: {
			id: "a:personal-conversation",
			conversationType: "personal",
			tenantId: TENANT_ID,
		},
		channelData: { tenant: { id: TENANT_ID } },
		value: {
			action: {
				type: "Action.Execute",
				verb: TEAMS_APPROVAL_VERBS.approve,
				data: teamsBoundActionData(BINDING_ID),
				id: "card-action-id",
			},
			trigger: "manual",
		},
		...overrides,
	};
}

describe("parseTeamsBoundApprovalInvoke", () => {
	it("reads a manual Universal Action on a bound card as an approval action", () => {
		expect(parseTeamsBoundApprovalInvoke(executeInvoke())).toEqual({
			kind: "action",
			action: "approve",
			bindingId: BINDING_ID,
		});
		const reject = executeInvoke({
			value: {
				action: {
					type: "Action.Execute",
					verb: TEAMS_APPROVAL_VERBS.reject,
					data: { b: BINDING_ID },
				},
				trigger: "manual",
			},
		});
		expect(parseTeamsBoundApprovalInvoke(reject)).toEqual({
			kind: "action",
			action: "reject",
			bindingId: BINDING_ID,
		});
	});

	it("never treats an automatic refresh as an approval click", () => {
		const refresh = executeInvoke({
			value: {
				action: {
					type: "Action.Execute",
					verb: TEAMS_APPROVAL_VERBS.approve,
					data: { b: BINDING_ID },
				},
				trigger: "automatic",
			},
		});
		expect(parseTeamsBoundApprovalInvoke(refresh)).toEqual({ kind: "refresh" });
	});

	it("refuses our verbs outside the supported profile", () => {
		const cases = [
			executeInvoke({ name: "task/fetch" }),
			executeInvoke({
				value: {
					action: {
						type: "Action.Execute",
						verb: TEAMS_APPROVAL_VERBS.approve,
						data: { b: BINDING_ID },
					},
				},
			}),
			executeInvoke({
				value: {
					action: {
						type: "Action.Submit",
						verb: TEAMS_APPROVAL_VERBS.approve,
						data: { b: BINDING_ID },
					},
					trigger: "manual",
				},
			}),
			executeInvoke({
				value: {
					action: {
						type: "Action.Execute",
						verb: TEAMS_APPROVAL_VERBS.approve,
						data: { b: BINDING_ID, approvalId: "legacy" },
					},
					trigger: "manual",
				},
			}),
			executeInvoke({
				value: {
					action: {
						type: "Action.Execute",
						verb: TEAMS_APPROVAL_VERBS.approve,
						data: { b: "not-a-uuid" },
					},
					trigger: "manual",
				},
			}),
		];
		for (const activity of cases) {
			expect(parseTeamsBoundApprovalInvoke(activity)).toEqual({ kind: "invalid" });
		}
	});

	it("leaves legacy and unrelated invokes to their own handlers", () => {
		expect(
			parseTeamsBoundApprovalInvoke(
				executeInvoke({ value: { action: "approve", approvalId: "legacy-request" } }),
			),
		).toEqual({ kind: "none" });
		expect(
			parseTeamsBoundApprovalInvoke(
				executeInvoke({ value: { action: "shift_pickup", shiftId: "shift" } }),
			),
		).toEqual({ kind: "none" });
		expect(
			parseTeamsBoundApprovalInvoke(
				executeInvoke({
					value: {
						action: { type: "Action.Execute", verb: "other.verb", data: {} },
						trigger: "manual",
					},
				}),
			),
		).toEqual({ kind: "none" });
		expect(parseTeamsBoundApprovalInvoke(executeInvoke({ type: "message" }))).toEqual({
			kind: "none",
		});
	});
});

describe("teamsInvocationEnvelope", () => {
	it("scopes the recorded activity ID by bot, tenant and conversation", () => {
		expect(teamsInvocationEnvelope(executeInvoke(), APP_ID)).toEqual({
			scheme: "teams_adaptive_card_action",
			receiverScope: `teams-bot:${APP_ID}:tenant:${TENANT_ID}:conversation:a:personal-conversation`,
			invocationId: "f:1234567890123456789",
			deliveryId: null,
			providerActorId: AAD_OBJECT_ID,
		});
	});

	it("never substitutes the card message or card action ID for a missing activity ID", () => {
		expect(teamsInvocationEnvelope(executeInvoke({ id: undefined }), APP_ID)).toBeNull();
		expect(teamsInvocationEnvelope(executeInvoke({ id: "  " }), APP_ID)).toBeNull();
	});

	it("refuses an unauthenticated or ambiguous scope", () => {
		const refused = [
			executeInvoke({ channelId: "webchat" }),
			executeInvoke({ recipient: { id: "28:another-bot" } }),
			executeInvoke({ from: { id: "29:opaque-user" } }),
			executeInvoke({ channelData: { tenant: { id: "11111111-2222-4333-8444-555555555555" } } }),
			executeInvoke({
				conversation: { id: "a:personal-conversation", conversationType: "personal" },
				channelData: {},
			}),
			executeInvoke({
				conversation: {
					id: "19:channel@thread.tacv2",
					conversationType: "channel",
					tenantId: TENANT_ID,
				},
			}),
			executeInvoke({
				conversation: { id: "", conversationType: "personal", tenantId: TENANT_ID },
			}),
		];
		for (const activity of refused) {
			expect(teamsInvocationEnvelope(activity, APP_ID)).toBeNull();
		}
		expect(teamsInvocationEnvelope(executeInvoke(), undefined)).toBeNull();
		expect(teamsInvocationEnvelope(executeInvoke(), "not-a-guid")).toBeNull();
	});

	it("accepts the tenant from channel data alone, kept exactly as sent", () => {
		const envelope = teamsInvocationEnvelope(
			executeInvoke({
				conversation: { id: "a:personal-conversation", conversationType: "personal" },
			}),
			APP_ID,
		);
		expect(envelope?.receiverScope).toContain(`:tenant:${TENANT_ID}:`);
	});
});

describe("teamsReceiverScope", () => {
	it("names the sending bot and tenant of a delivered message", () => {
		expect(teamsReceiverScope(APP_ID, TENANT_ID)).toBe(`teams-bot:${APP_ID}:tenant:${TENANT_ID}`);
		expect(teamsReceiverScope(undefined, TENANT_ID)).toBeNull();
		expect(teamsReceiverScope(APP_ID, "tenant")).toBeNull();
	});
});
