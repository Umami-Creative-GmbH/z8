import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handleEvent: vi.fn(),
	getBotConfigByTeamId: vi.fn(),
	handleSlackCandidateEventRequest: vi.fn(),
	handleSlackCandidateInteractionRequest: vi.fn(),
	handleSlackCandidateCommandRequest: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("next/server")>();
	return {
		...actual,
		connection: vi.fn().mockResolvedValue(undefined),
	};
});

vi.mock("@/env", () => ({
	env: {
		SLACK_SIGNING_SECRET: "legacy-deployment-signing-secret",
	},
}));

vi.mock("@/lib/slack/bot-config", () => ({
	getBotConfigByTeamId: mocks.getBotConfigByTeamId,
}));

vi.mock("@/lib/slack/bot-handler", () => ({
	handleEvent: mocks.handleEvent,
}));

vi.mock("@/lib/chat-installations/slack-candidate-routes", () => ({
	handleSlackCandidateEventRequest: mocks.handleSlackCandidateEventRequest,
	handleSlackCandidateInteractionRequest: mocks.handleSlackCandidateInteractionRequest,
	handleSlackCandidateCommandRequest: mocks.handleSlackCandidateCommandRequest,
}));

import { POST as legacyEventsPost } from "@/app/api/slack/events/route";
import { POST as candidateCommandsPost } from "@/app/api/slack/installations/[routeId]/commands/route";
import { POST as candidateEventsPost } from "@/app/api/slack/installations/[routeId]/events/route";
import { POST as candidateInteractionsPost } from "@/app/api/slack/installations/[routeId]/interactions/route";

function sign(secret: string, timestamp: string, rawBody: string): string {
	return `v0=${crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

function makeRequest(rawBody: string, headers: Record<string, string>): NextRequest {
	return new Request("https://app.z8-time.test/api/slack/events", {
		method: "POST",
		headers,
		body: rawBody,
	}) as unknown as NextRequest;
}

describe("Legacy Slack route stays uninterrupted alongside candidate installation routes (#2041)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getBotConfigByTeamId.mockResolvedValue({
			organizationId: "org-1",
			botAccessToken: "xoxb-legacy-live",
			slackTeamId: "T01WORKSPACE",
			slackTeamName: "Acme Workspace",
			botUserId: "U01LEGACY",
			setupStatus: "active",
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		});
		mocks.handleEvent.mockResolvedValue(undefined);
	});

	test("legacy POST /api/slack/events continues delivering to active legacy workspace while candidate routes operate independently", async () => {
		const ts = String(Math.floor(Date.now() / 1000));
		const legacyPayload = JSON.stringify({
			type: "event_callback",
			team_id: "T01WORKSPACE",
			event: { type: "message", channel_type: "im", user: "UEMPLOYEE1", text: "status" },
		});

		const legacyRes = await legacyEventsPost(
			makeRequest(legacyPayload, {
				"x-slack-request-timestamp": ts,
				"x-slack-signature": sign("legacy-deployment-signing-secret", ts, legacyPayload),
			}),
		);

		expect(legacyRes.status).toBe(200);
		expect(mocks.getBotConfigByTeamId).toHaveBeenCalledWith("T01WORKSPACE");
		expect(mocks.handleEvent).toHaveBeenCalledTimes(1);

		// Candidate route dispatches strictly via routeId to candidate handlers
		mocks.handleSlackCandidateEventRequest.mockResolvedValueOnce({
			status: 200,
			body: { ok: true, mode: "candidate", verificationRecorded: true },
		});
		mocks.handleSlackCandidateInteractionRequest.mockResolvedValueOnce({
			status: 403,
			body: { error: "Candidate cannot process interactions" },
		});
		mocks.handleSlackCandidateCommandRequest.mockResolvedValueOnce({
			status: 403,
			body: { error: "Candidate cannot execute commands" },
		});

		const candEventsRes = await candidateEventsPost(
			makeRequest("{}", { "x-slack-request-timestamp": ts, "x-slack-signature": "v0=sig" }),
			{ params: Promise.resolve({ routeId: "route_cand_1" }) },
		);
		expect(candEventsRes.status).toBe(200);
		expect(mocks.handleSlackCandidateEventRequest).toHaveBeenCalledWith(
			expect.objectContaining({ routeId: "route_cand_1" }),
		);

		const candIntRes = await candidateInteractionsPost(
			makeRequest("payload={}", { "x-slack-request-timestamp": ts, "x-slack-signature": "v0=sig" }),
			{ params: Promise.resolve({ routeId: "route_cand_1" }) },
		);
		expect(candIntRes.status).toBe(403);

		const candCmdRes = await candidateCommandsPost(
			makeRequest("command=/z8", {
				"x-slack-request-timestamp": ts,
				"x-slack-signature": "v0=sig",
			}),
			{ params: Promise.resolve({ routeId: "route_cand_1" }) },
		);
		expect(candCmdRes.status).toBe(403);
	});
});
