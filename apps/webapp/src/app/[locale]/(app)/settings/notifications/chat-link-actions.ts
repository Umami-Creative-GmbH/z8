"use server";

import { Effect } from "effect";
import { z } from "zod";
import { CHAT_INSTALLATION_PROVIDERS } from "@/db/schema/chat-installations";
import {
	getMemberChatLinks,
	issueMemberTelegramCandidateLinkCode,
	issueMemberTelegramLinkCode,
	type MemberChatLinksSnapshot,
	unlinkMemberChatLink,
} from "@/lib/chat-installations/member-links";
import { AuthorizationError, ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

export interface GeneratedMemberLinkCode {
	code: string;
	expiresAt: string;
	installationId: string;
	botUsername: string | null;
}

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

/**
 * Loads the current employee's chat link status across the active organization's
 * configured chat channels (Telegram, Slack, Teams, Discord).
 */
export const getMemberChatLinksAction = organizationAction(
	{ name: "notifications.getMemberChatLinks", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.tryPromise({
			try: (): Promise<MemberChatLinksSnapshot> =>
				getMemberChatLinks({ userId: actor.userId, organizationId }),
			catch: chatLinkFailure("getMemberChatLinks", "Couldn't verify chat connections"),
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
			const result = yield* Effect.tryPromise({
				try: () => issueMemberTelegramLinkCode({ userId: actor.userId, organizationId }),
				catch: chatLinkFailure("issueMemberTelegramLinkCode", "Failed to generate link code"),
			});

			switch (result.status) {
				case "issued":
					return {
						code: result.code,
						expiresAt: result.expiresAt.toISOString(),
						installationId: result.installationId,
						botUsername: result.botUsername,
					} satisfies GeneratedMemberLinkCode;
				case "installation_unavailable":
					return yield* Effect.fail(
						new ValidationError({
							message: "Telegram is not configured for this organization",
						}),
					);
				case "ineligible":
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You are not eligible to link a chat account in this organization",
							userId: actor.userId,
							resource: "notifications.generateTelegramLinkCode",
							action: "member",
						}),
					);
				case "rate_limited":
					return yield* Effect.fail(
						new ValidationError({
							message: "Too many link code requests. Please wait a few minutes and try again.",
						}),
					);
			}
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
			const result = yield* Effect.tryPromise({
				try: () =>
					issueMemberTelegramCandidateLinkCode({
						userId: actor.userId,
						organizationId,
						installationId: input.installationId,
					}),
				catch: chatLinkFailure(
					"issueMemberTelegramCandidateLinkCode",
					"Failed to generate replacement bot link code",
				),
			});

			switch (result.status) {
				case "issued":
					return {
						code: result.code,
						expiresAt: result.expiresAt.toISOString(),
						installationId: result.installationId,
						botUsername: result.botUsername,
					} satisfies GeneratedMemberLinkCode;
				case "installation_unavailable":
					return yield* Effect.fail(
						new ValidationError({
							message: "No staged replacement Telegram bot is available for this organization",
						}),
					);
				case "ineligible":
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You are not eligible to link a chat account in this organization",
							userId: actor.userId,
							resource: "notifications.generateTelegramCandidateLinkCode",
							action: "member",
						}),
					);
				case "rate_limited":
					return yield* Effect.fail(
						new ValidationError({
							message: "Too many link code requests. Please wait a few minutes and try again.",
						}),
					);
			}
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
		Effect.tryPromise({
			try: () =>
				unlinkMemberChatLink({
					userId: actor.userId,
					organizationId,
					provider: input.provider,
					installationId: input.installationId,
				}),
			catch: chatLinkFailure("unlinkMemberChatLink", "Failed to unlink chat account"),
		}),
);
