"use server";

import { Effect } from "effect";
import { z } from "zod";
import {
	CHAT_INSTALLATION_PROVIDERS,
	type ChatInstallationProvider,
} from "@/db/schema/chat-installations";
import type { ChatLinkProofPurpose } from "@/db/schema";

export type { ChatLinkProofPurpose };
import {
	getMemberChatLinks,
	type IssueChatLinkProofResult,
	issueMemberChatLinkCode,
	issueMemberTelegramCandidateLinkCode,
	issueMemberTelegramLinkCode,
	type MemberChatLinksSnapshot,
	unlinkMemberChatLink,
} from "@/lib/chat-installations/member-links";
import { AuthorizationError, ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

export interface GeneratedMemberLinkCode {
	code: string;
	expiresAt: string;
	installationId: string;
	botUsername: string | null;
	provider?: ChatInstallationProvider;
	purpose?: ChatLinkProofPurpose;
}

const generateChatLinkCodeSchema = z.strictObject({
	provider: z.enum(CHAT_INSTALLATION_PROVIDERS),
	purpose: z.enum(["member_link", "candidate_enrollment"]).optional(),
	installationId: z.string().uuid().optional(),
});

const unlinkChatAccountSchema = z.strictObject({
	provider: z.enum(CHAT_INSTALLATION_PROVIDERS),
	installationId: z.string().uuid().optional(),
});

const generateCandidateLinkCodeSchema = z.strictObject({
	installationId: z.string().uuid(),
});

function chatLinkFailure(operation: string, message: string) {
	return (cause: unknown) =>
		new ExternalServiceError({ message, service: "chat-installations", operation, cause });
}

function mapIssuedLinkCodeOutcome(
	result: IssueChatLinkProofResult,
	context: {
		userId: string;
		resource: string;
		unavailableMessage: string;
		provider?: ChatInstallationProvider;
	},
) {
	switch (result.status) {
		case "issued":
			return Effect.succeed({
				code: result.code,
				expiresAt: result.expiresAt.toISOString(),
				installationId: result.installationId,
				botUsername: result.botUsername,
				...(context.provider ? { provider: context.provider, purpose: result.purpose } : {}),
			} satisfies GeneratedMemberLinkCode);
		case "installation_unavailable":
			return Effect.fail(
				new ValidationError({
					message: context.unavailableMessage,
					refusal: "chat_link_unavailable",
				}),
			);
		case "ineligible":
			return Effect.fail(
				new AuthorizationError({
					message: "You are not eligible to link a chat account in this organization",
					userId: context.userId,
					resource: context.resource,
					action: "member",
				}),
			);
		case "rate_limited":
			return Effect.fail(
				new ValidationError({
					message: "Too many link code requests. Please wait a few minutes and try again.",
					refusal: "chat_link_rate_limited",
				}),
			);
	}
}

/**
 * Loads the current employee's chat link status across the active organization's
 * configured chat channels (Telegram, Slack, Teams, Discord).
 */
export const getMemberChatLinksAction = organizationAction(
	{ name: "notifications.getMemberChatLinks", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* Effect.tryPromise({
				try: (): Promise<MemberChatLinksSnapshot> =>
					getMemberChatLinks({ userId: actor.userId, organizationId }, { db: dbService.db }),
				catch: chatLinkFailure("getMemberChatLinks", "Couldn't verify chat connections"),
			});
		}),
);

/**
 * Generates a short-lived, single-use, installation-bound link proof for any
 * configured chat provider (Telegram, Slack, Microsoft Teams, Discord) and
 * lane (`member_link` or `candidate_enrollment`).
 */
export const generateMemberChatLinkCode = organizationAction(
	{
		name: "notifications.generateChatLinkCode",
		requires: "member",
		schema: generateChatLinkCodeSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const purpose: ChatLinkProofPurpose = input.purpose ?? "member_link";
			const result = yield* Effect.tryPromise({
				try: () =>
					issueMemberChatLinkCode(
						{
							userId: actor.userId,
							organizationId,
							provider: input.provider,
							purpose,
							installationId: input.installationId,
						},
						{ db: dbService.db },
					),
				catch: chatLinkFailure("issueMemberChatLinkCode", "Failed to generate link code"),
			});

			return yield* mapIssuedLinkCodeOutcome(result, {
				userId: actor.userId,
				resource: "notifications.generateChatLinkCode",
				unavailableMessage:
					purpose === "candidate_enrollment"
						? "No staged replacement installation is available for this channel"
						: "This chat channel is not configured for this organization",
				provider: input.provider,
			});
		}),
);

/**
 * Generates a short-lived, single-use, installation-bound Telegram link proof
 * for the signed-in employee in their active organization.
 */
export const generateMemberTelegramLinkCode = organizationAction(
	{ name: "notifications.generateTelegramLinkCode", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* Effect.tryPromise({
				try: () =>
					issueMemberTelegramLinkCode(
						{ userId: actor.userId, organizationId },
						{ db: dbService.db },
					),
				catch: chatLinkFailure("issueMemberTelegramLinkCode", "Failed to generate link code"),
			});

			return yield* mapIssuedLinkCodeOutcome(result, {
				userId: actor.userId,
				resource: "notifications.generateTelegramLinkCode",
				unavailableMessage: "Telegram is not configured for this organization",
			});
		}),
);

/**
 * Generates a short-lived, single-use `candidate_enrollment` link proof for a staged
 * replacement Telegram bot without disturbing the member's active live Telegram link.
 */
export const generateMemberTelegramCandidateLinkCode = organizationAction(
	{
		name: "notifications.generateTelegramCandidateLinkCode",
		requires: "member",
		schema: generateCandidateLinkCodeSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* Effect.tryPromise({
				try: () =>
					issueMemberTelegramCandidateLinkCode(
						{
							userId: actor.userId,
							organizationId,
							installationId: input.installationId,
						},
						{ db: dbService.db },
					),
				catch: chatLinkFailure(
					"issueMemberTelegramCandidateLinkCode",
					"Failed to generate replacement bot link code",
				),
			});

			return yield* mapIssuedLinkCodeOutcome(result, {
				userId: actor.userId,
				resource: "notifications.generateTelegramCandidateLinkCode",
				unavailableMessage: "No staged replacement Telegram bot is available for this organization",
			});
		}),
);

/**
 * Unlinks the signed-in employee's chat connection for one provider in their
 * active organization without affecting any other organization they belong to.
 */
export const unlinkMemberChatAccount = organizationAction(
	{
		name: "notifications.unlinkChatAccount",
		requires: "member",
		schema: unlinkChatAccountSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* Effect.tryPromise({
				try: () =>
					unlinkMemberChatLink(
						{
							userId: actor.userId,
							organizationId,
							provider: input.provider,
							installationId: input.installationId,
						},
						{ db: dbService.db },
					),
				catch: chatLinkFailure("unlinkMemberChatLink", "Failed to unlink chat account"),
			});
		}),
);
