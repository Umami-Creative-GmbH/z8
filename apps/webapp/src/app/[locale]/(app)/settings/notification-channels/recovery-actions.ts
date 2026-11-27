"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	type BeginChatInstallationRestoreResult,
	beginChatInstallationRestore,
	type ChatInstallationRecoveryState,
	type ConfirmChatInstallationRestoreResult,
	confirmChatInstallationRestore,
	getChatInstallationRecoveryState,
	type RevokeChatInstallationResult,
	type RotateChatInstallationCredentialsResult,
	revokeChatInstallation,
	rotateChatInstallationCredentials,
	type VerifyRestoredChatInstallationResult,
	verifyRestoredChatInstallation,
} from "@/lib/chat-installations";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const rotateSlackCredentialsSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		botToken: z.string({ error: "Bot token is required" }).trim().min(1, "Bot token is required"),
		signingSecret: z
			.string({ error: "Signing secret is required" })
			.trim()
			.min(1, "Signing secret is required"),
	},
	"Slack rotation credentials are required",
);

const revokeSlackInstallationSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		reason: z.string().trim().max(240).optional(),
	},
	"Installation ID is required",
);

const prepareSlackRestoreSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
	},
	"Installation ID is required",
);

const verifySlackRestoreSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		botToken: z.string().trim().optional(),
		signingSecret: z.string().trim().optional(),
		slackUserId: z.string().trim().optional(),
	},
	"Restore verification details are required",
);

const confirmSlackRestoreSchema = z.strictObject(
	{
		candidateInstallationId: z
			.string({ error: "Candidate installation ID is required" })
			.uuid("Invalid candidate installation ID"),
		reviewedCurrentInstallationId: z.string().uuid().nullable(),
		reviewedCurrentCredentialRevisionId: z.string().uuid().nullable(),
		reviewedCandidateCredentialRevisionId: z.string().uuid().nullable(),
		reviewedImpactDigest: z
			.string({ error: "Reviewed impact digest is required" })
			.regex(/^[a-f0-9]{64}$/, "Invalid impact digest"),
		acknowledgeUnreadyEmployees: z.boolean({
			error: "Acknowledgment must be a boolean",
		}),
	},
	"Restore confirmation details are required",
);

export interface RotateSlackCredentialsActionInput {
	installationId: string;
	botToken: string;
	signingSecret: string;
}

export type RotatedSlackInstallationData = Extract<
	RotateChatInstallationCredentialsResult,
	{ kind: "rotated" }
> & {
	recoveryState: ChatInstallationRecoveryState;
};

export interface RevokeSlackInstallationActionInput {
	installationId: string;
	reason?: string;
}

export type RevokedSlackInstallationData = Extract<
	RevokeChatInstallationResult,
	{ kind: "revoked" | "already_revoked" }
> & {
	recoveryState: ChatInstallationRecoveryState;
};

export interface PrepareSlackRestoreActionInput {
	installationId: string;
}

export type PreparedSlackRestoreData = Extract<
	BeginChatInstallationRestoreResult,
	{ kind: "restore_started" }
> & {
	recoveryState: ChatInstallationRecoveryState;
};

export interface VerifySlackRestoreActionInput {
	installationId: string;
	botToken?: string;
	signingSecret?: string;
	slackUserId?: string;
}

export type VerifiedSlackRestoreData = Extract<
	VerifyRestoredChatInstallationResult,
	{ kind: "verified_step" }
> & {
	recoveryState: ChatInstallationRecoveryState;
};

export interface ConfirmSlackRestoreActionInput {
	candidateInstallationId: string;
	reviewedCurrentInstallationId: string | null;
	reviewedCurrentCredentialRevisionId: string | null;
	reviewedCandidateCredentialRevisionId: string | null;
	reviewedImpactDigest: string;
	acknowledgeUnreadyEmployees: boolean;
}

export type ConfirmedSlackRestoreData = Extract<
	ConfirmChatInstallationRestoreResult,
	{ kind: "switched" }
> & {
	recoveryState: ChatInstallationRecoveryState;
};

export const getSlackRecoveryState = organizationAction(
	{
		name: "notificationChannels.slackRecovery.get",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"notificationChannels.slackRecovery.get",
				(): Promise<ChatInstallationRecoveryState> =>
					getChatInstallationRecoveryState(
						{ organizationId, provider: "slack" },
						{ db: dbService.db },
					),
			);
		}),
);

export const rotateSlackInstallationCredentials = organizationAction(
	{
		name: "notificationChannels.slackRecovery.rotate",
		requires: "orgAdmin",
		schema: rotateSlackCredentialsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.slackRecovery.rotate",
				(): Promise<RotateChatInstallationCredentialsResult> =>
					rotateChatInstallationCredentials(
						{
							organizationId,
							installationId: input.installationId,
							actorUserId: actor.userId,
							secrets: {
								bot_token: input.botToken,
								signing_secret: input.signingSecret,
							},
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "refused") {
				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						refusal: result.code,
					}),
				);
			}

			const recoveryState = yield* dbService.query(
				"notificationChannels.slackRecovery.rotate.reload",
				() =>
					getChatInstallationRecoveryState(
						{ organizationId, provider: "slack" },
						{ db: dbService.db },
					),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				recoveryState,
			} satisfies RotatedSlackInstallationData;
		}),
);

export const revokeSlackInstallation = organizationAction(
	{
		name: "notificationChannels.slackRecovery.revoke",
		requires: "orgAdmin",
		schema: revokeSlackInstallationSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.slackRecovery.revoke",
				(): Promise<RevokeChatInstallationResult> =>
					revokeChatInstallation(
						{
							organizationId,
							installationId: input.installationId,
							actorUserId: actor.userId,
							reason: input.reason,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "refused") {
				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						refusal: result.code,
					}),
				);
			}

			const recoveryState = yield* dbService.query(
				"notificationChannels.slackRecovery.revoke.reload",
				() =>
					getChatInstallationRecoveryState(
						{ organizationId, provider: "slack" },
						{ db: dbService.db },
					),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				recoveryState,
			} satisfies RevokedSlackInstallationData;
		}),
);

export const prepareSlackInstallationRestore = organizationAction(
	{
		name: "notificationChannels.slackRecovery.prepareRestore",
		requires: "orgAdmin",
		schema: prepareSlackRestoreSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.slackRecovery.prepareRestore",
				(): Promise<BeginChatInstallationRestoreResult> =>
					beginChatInstallationRestore(
						{
							organizationId,
							installationId: input.installationId,
							actorUserId: actor.userId,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "refused") {
				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						refusal: result.code,
					}),
				);
			}

			const recoveryState = yield* dbService.query(
				"notificationChannels.slackRecovery.prepareRestore.reload",
				() =>
					getChatInstallationRecoveryState(
						{
							organizationId,
							provider: "slack",
							restoreCandidateId: result.installationId,
						},
						{ db: dbService.db },
					),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				recoveryState,
			} satisfies PreparedSlackRestoreData;
		}),
);

export const verifySlackInstallationRestore = organizationAction(
	{
		name: "notificationChannels.slackRecovery.verifyRestore",
		requires: "orgAdmin",
		schema: verifySlackRestoreSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.slackRecovery.verifyRestore",
				(): Promise<VerifyRestoredChatInstallationResult> =>
					verifyRestoredChatInstallation(
						{
							organizationId,
							installationId: input.installationId,
							actorUserId: actor.userId,
							botToken: input.botToken,
							signingSecret: input.signingSecret,
							slackUserId: input.slackUserId,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "refused") {
				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						refusal: result.code,
					}),
				);
			}

			const recoveryState = yield* dbService.query(
				"notificationChannels.slackRecovery.verifyRestore.reload",
				() =>
					getChatInstallationRecoveryState(
						{
							organizationId,
							provider: "slack",
							restoreCandidateId: result.installationId,
						},
						{ db: dbService.db },
					),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				recoveryState,
			} satisfies VerifiedSlackRestoreData;
		}),
);

export const confirmSlackInstallationRestore = organizationAction(
	{
		name: "notificationChannels.slackRecovery.confirmRestore",
		requires: "orgAdmin",
		schema: confirmSlackRestoreSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.slackRecovery.confirmRestore",
				(): Promise<ConfirmChatInstallationRestoreResult> =>
					confirmChatInstallationRestore(
						{
							organizationId,
							provider: "slack",
							actorUserId: actor.userId,
							candidateInstallationId: input.candidateInstallationId,
							reviewedCurrentInstallationId: input.reviewedCurrentInstallationId,
							reviewedCurrentCredentialRevisionId: input.reviewedCurrentCredentialRevisionId,
							reviewedCandidateCredentialRevisionId: input.reviewedCandidateCredentialRevisionId,
							reviewedImpactDigest: input.reviewedImpactDigest,
							acknowledgeUnreadyEmployees: input.acknowledgeUnreadyEmployees,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "refused") {
				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						refusal: result.code,
						value: "freshPreview" in result ? { preview: result.freshPreview } : undefined,
					}),
				);
			}

			const recoveryState = yield* dbService.query(
				"notificationChannels.slackRecovery.confirmRestore.reload",
				() =>
					getChatInstallationRecoveryState(
						{ organizationId, provider: "slack" },
						{ db: dbService.db },
					),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				recoveryState,
			} satisfies ConfirmedSlackRestoreData;
		}),
);
