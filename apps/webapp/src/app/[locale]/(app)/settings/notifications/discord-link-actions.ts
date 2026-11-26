"use server";

import { Effect } from "effect";
import { z } from "zod";
import {
	getMemberDiscordLinkState,
	issueMemberDiscordLinkCode,
	type MemberDiscordLinkState,
	type RecheckMemberDiscordDmResult,
	recheckMemberDiscordDmReachability,
	unlinkMemberChatLink,
} from "@/lib/chat-installations";
import { AuthorizationError, ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const generateDiscordLinkCodeSchema = z.strictObject({
	purpose: z.enum(["member_link", "candidate_enrollment"]).optional(),
	installationId: z.string().uuid().optional(),
});

const recheckDiscordDmSchema = z.strictObject({
	installationId: z
		.string({ error: "Installation ID is required" })
		.uuid("Invalid installation ID"),
});

const unlinkDiscordSchema = z.strictObject({
	installationId: z.string().uuid().optional(),
});

export interface GeneratedMemberDiscordLinkCode {
	code: string;
	expiresAt: string;
	installationId: string;
	purpose: "member_link" | "candidate_enrollment";
}

function discordLinkFailure(operation: string, message: string) {
	return (cause: unknown) =>
		new ExternalServiceError({ message, service: "discord", operation, cause });
}

export const getMemberDiscordLinkStateAction = organizationAction(
	{
		name: "notifications.discord.getMemberLinkState",
		requires: "member",
		schema: noInput,
	},
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* Effect.tryPromise({
				try: (): Promise<MemberDiscordLinkState> =>
					getMemberDiscordLinkState({ userId: actor.userId, organizationId }, { db: dbService.db }),
				catch: discordLinkFailure(
					"getMemberDiscordLinkState",
					"Couldn't load your Discord connection status",
				),
			});
		}),
);

export const generateMemberDiscordLinkCode = organizationAction(
	{
		name: "notifications.discord.generateLinkCode",
		requires: "member",
		schema: generateDiscordLinkCodeSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const purpose = input.purpose ?? "member_link";
			const result = yield* Effect.tryPromise({
				try: () =>
					issueMemberDiscordLinkCode(
						{
							userId: actor.userId,
							organizationId,
							purpose,
							installationId: input.installationId,
						},
						{ db: dbService.db },
					),
				catch: discordLinkFailure(
					"issueMemberDiscordLinkCode",
					"Failed to generate Discord link code",
				),
			});

			switch (result.status) {
				case "issued":
					return {
						code: result.code,
						expiresAt: result.expiresAt.toISOString(),
						installationId: result.installationId,
						purpose: result.purpose,
					} satisfies GeneratedMemberDiscordLinkCode;
				case "installation_unavailable":
					return yield* Effect.fail(
						new ValidationError({
							message: "Discord is not available for linking in this organization.",
							refusal: "chat_link_unavailable",
						}),
					);
				case "ineligible":
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You are not eligible to link a Discord account in this organization.",
							userId: actor.userId,
							resource: "notifications.discord.generateLinkCode",
							action: "member",
						}),
					);
				case "rate_limited":
					return yield* Effect.fail(
						new ValidationError({
							message: "Too many link code requests. Please wait a few minutes and try again.",
							refusal: "chat_link_rate_limited",
						}),
					);
			}
		}),
);

export const recheckMemberDiscordDmAction = organizationAction(
	{
		name: "notifications.discord.recheckDm",
		requires: "member",
		schema: recheckDiscordDmSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* Effect.tryPromise({
				try: (): Promise<RecheckMemberDiscordDmResult> =>
					recheckMemberDiscordDmReachability(
						{
							userId: actor.userId,
							organizationId,
							installationId: input.installationId,
						},
						{ db: dbService.db },
					),
				catch: discordLinkFailure(
					"recheckMemberDiscordDmReachability",
					"Failed to check Discord direct message delivery",
				),
			});

			if (result.kind === "refused") {
				if (result.code === "ineligible") {
					return yield* Effect.fail(
						new AuthorizationError({
							message: result.message,
							userId: actor.userId,
							resource: "notifications.discord.recheckDm",
							action: "member",
						}),
					);
				}
				if (result.code === "secret_store_unavailable") {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: "secret_store",
							operation: "recheckMemberDiscordDmReachability",
						}),
					);
				}
				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						refusal: result.code,
					}),
				);
			}

			return result;
		}),
);

export const unlinkMemberDiscordAccount = organizationAction(
	{
		name: "notifications.discord.unlink",
		requires: "member",
		schema: unlinkDiscordSchema,
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
							provider: "discord",
							installationId: input.installationId,
						},
						{ db: dbService.db },
					),
				catch: discordLinkFailure("unlinkMemberChatLink", "Failed to unlink Discord account"),
			});
		}),
);
