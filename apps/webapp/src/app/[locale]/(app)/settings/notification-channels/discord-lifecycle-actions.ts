"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	type BeginChatInstallationRestoreResult,
	beginChatInstallationRestore,
	buildChatSwitchImpactPreview,
	type ChatInstallationRecoveryState,
	type ChatSwitchDb,
	type ChatSwitchImpactPreview,
	type ConfirmChatInstallationRestoreResult,
	type ConfirmChatInstallationSwitchResult,
	confirmChatInstallationRestore,
	confirmChatInstallationSwitch,
	configureDiscordCandidateCredentials,
	type DiscordCandidateSetupView,
	getChatInstallationRecoveryState,
	getDiscordCandidateSetupView,
	prepareDiscordCandidateInstallation,
	type RevokeChatInstallationResult,
	type RotateChatInstallationCredentialsResult,
	retryDiscordCandidateCommandRegistration,
	revokeChatInstallation,
	rotateDiscordInstallationCredentials,
	sendDiscordCandidatePrivateTestMessage,
} from "@/lib/chat-installations";
import { ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const saveDiscordCredentialsSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		botToken: z.string({ error: "Bot token is required" }).trim().min(1, "Bot token is required"),
		applicationId: z
			.string({ error: "Application ID is required" })
			.trim()
			.min(1, "Application ID is required"),
		publicKey: z
			.string({ error: "Public key is required" })
			.trim()
			.min(1, "Public key is required"),
	},
	"Discord credentials are required",
);

const installationIdSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
	},
	"Installation ID is required",
);

const sendDiscordPrivateTestSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		discordUserId: z
			.string({ error: "Discord user ID is required" })
			.trim()
			.min(1, "Discord user ID is required"),
	},
	"Test recipient details are required",
);

const confirmDiscordSwitchSchema = z.strictObject(
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
	"Switch confirmation details are required",
);

const rotateDiscordCredentialsSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		botToken: z.string({ error: "Bot token is required" }).trim().min(1, "Bot token is required"),
		publicKey: z.string().trim().optional(),
	},
	"Discord rotation credentials are required",
);

const revokeDiscordInstallationSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		reason: z.string().trim().max(240).optional(),
	},
	"Installation ID is required",
);

export interface DiscordLifecycleState {
	candidateSetup: DiscordCandidateSetupView | null;
	switchPreview: ChatSwitchImpactPreview;
	recoveryState: ChatInstallationRecoveryState;
}

export interface SaveDiscordCandidateCredentialsInput {
	installationId: string;
	botToken: string;
	applicationId: string;
	publicKey: string;
}

export interface SendDiscordPrivateTestInput {
	installationId: string;
	discordUserId: string;
}

export interface ConfirmDiscordSwitchActionInput {
	candidateInstallationId: string;
	reviewedCurrentInstallationId: string | null;
	reviewedCurrentCredentialRevisionId: string | null;
	reviewedCandidateCredentialRevisionId: string | null;
	reviewedImpactDigest: string;
	acknowledgeUnreadyEmployees: boolean;
}

export interface RotateDiscordCredentialsActionInput {
	installationId: string;
	botToken: string;
	publicKey?: string;
}

export interface RevokeDiscordInstallationActionInput {
	installationId: string;
	reason?: string;
}

export type ConfirmedDiscordSwitchData = Extract<
	ConfirmChatInstallationSwitchResult,
	{ kind: "switched" }
> & {
	lifecycle: DiscordLifecycleState;
};

export type RotatedDiscordInstallationData = Extract<
	RotateChatInstallationCredentialsResult,
	{ kind: "rotated" }
> & {
	lifecycle: DiscordLifecycleState;
};

export type RevokedDiscordInstallationData = Extract<
	RevokeChatInstallationResult,
	{ kind: "revoked" | "already_revoked" }
> & {
	lifecycle: DiscordLifecycleState;
};

export type PreparedDiscordRestoreData = Extract<
	BeginChatInstallationRestoreResult,
	{ kind: "restore_started" }
> & {
	lifecycle: DiscordLifecycleState;
};

async function loadDiscordLifecycleState(
	db: ChatSwitchDb,
	organizationId: string,
	restoreCandidateId?: string | null,
): Promise<DiscordLifecycleState> {
	const [candidateSetup, switchPreview, recoveryState] = await Promise.all([
		getDiscordCandidateSetupView(organizationId, { db }),
		buildChatSwitchImpactPreview(
			{ organizationId, provider: "discord", candidateInstallationId: restoreCandidateId },
			{ db },
		),
		getChatInstallationRecoveryState(
			{ organizationId, provider: "discord", restoreCandidateId },
			{ db },
		),
	]);
	return { candidateSetup, switchPreview, recoveryState };
}

export const getDiscordLifecycleState = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.get",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("notificationChannels.discordLifecycle.get", () =>
				loadDiscordLifecycleState(dbService.db, organizationId),
			);
		}),
);

export const prepareDiscordCandidate = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.prepare",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const lifecycle = yield* dbService.query(
				"notificationChannels.discordLifecycle.prepare",
				async () => {
					await prepareDiscordCandidateInstallation(
						{ organizationId, actorUserId: actor.userId },
						{ db: dbService.db },
					);
					return loadDiscordLifecycleState(dbService.db, organizationId);
				},
			);
			revalidatePath("/settings/notification-channels");
			return lifecycle;
		}),
);

export const saveAndVerifyDiscordCandidateCredentials = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.saveCredentials",
		requires: "orgAdmin",
		schema: saveDiscordCredentialsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.discordLifecycle.saveCredentials",
				() =>
					configureDiscordCandidateCredentials(
						{
							organizationId,
							actorUserId: actor.userId,
							installationId: input.installationId,
							botToken: input.botToken,
							applicationId: input.applicationId,
							publicKey: input.publicKey,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "error") {
				if (
					result.code === "discord_unavailable" ||
					result.code === "secret_store_unavailable" ||
					result.code === "credential_write_failed"
				) {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: result.code === "discord_unavailable" ? "discord" : "secret_store",
							operation: "saveAndVerifyDiscordCandidateCredentials",
							cause: { code: result.code },
						}),
					);
				}

				const field =
					result.code === "invalid_application_id_format" ||
					result.code === "application_id_mismatch"
						? "applicationId"
						: result.code === "invalid_public_key_format" || result.code === "public_key_mismatch"
							? "publicKey"
							: result.code === "invalid_bot_token_format" || result.code === "invalid_bot_token"
								? "botToken"
								: undefined;

				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						field,
						refusal: result.code,
					}),
				);
			}

			const lifecycle = yield* dbService.query(
				"notificationChannels.discordLifecycle.saveCredentials.reload",
				() => loadDiscordLifecycleState(dbService.db, organizationId),
			);

			revalidatePath("/settings/notification-channels");
			return {
				commandsRegistered: result.commandsRegistered,
				lifecycle,
			};
		}),
);

export const retryDiscordCandidateCommands = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.retryCommands",
		requires: "orgAdmin",
		schema: installationIdSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.discordLifecycle.retryCommands",
				() =>
					retryDiscordCandidateCommandRegistration(
						{
							organizationId,
							actorUserId: actor.userId,
							installationId: input.installationId,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "error") {
				if (
					result.code === "secret_store_unavailable" ||
					result.code === "command_registration_failed"
				) {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: result.code === "secret_store_unavailable" ? "secret_store" : "discord",
							operation: "retryDiscordCandidateCommands",
							cause: { code: result.code },
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

			const lifecycle = yield* dbService.query(
				"notificationChannels.discordLifecycle.retryCommands.reload",
				() => loadDiscordLifecycleState(dbService.db, organizationId),
			);

			revalidatePath("/settings/notification-channels");
			return lifecycle;
		}),
);

export const sendDiscordCandidatePrivateTest = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.sendPrivateTest",
		requires: "orgAdmin",
		schema: sendDiscordPrivateTestSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.discordLifecycle.sendPrivateTest",
				() =>
					sendDiscordCandidatePrivateTestMessage(
						{
							organizationId,
							actorUserId: actor.userId,
							installationId: input.installationId,
							discordUserId: input.discordUserId,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "error") {
				if (
					result.code === "secret_store_unavailable" ||
					result.code === "discord_unavailable" ||
					result.code === "discord_rate_limited"
				) {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: result.code === "secret_store_unavailable" ? "secret_store" : "discord",
							operation: "sendDiscordCandidatePrivateTest",
							cause: { code: result.code },
						}),
					);
				}

				const lifecycle = result.view
					? yield* dbService.query(
							"notificationChannels.discordLifecycle.sendPrivateTest.reloadFailed",
							() => loadDiscordLifecycleState(dbService.db, organizationId),
						)
					: undefined;

				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						field: result.code === "invalid_discord_user_id" ? "discordUserId" : undefined,
						refusal: result.code,
						value: lifecycle ? { lifecycle, recoveryHint: result.recoveryHint ?? null } : undefined,
					}),
				);
			}

			const lifecycle = yield* dbService.query(
				"notificationChannels.discordLifecycle.sendPrivateTest.reload",
				() => loadDiscordLifecycleState(dbService.db, organizationId),
			);

			revalidatePath("/settings/notification-channels");
			return lifecycle;
		}),
);

export const confirmDiscordInstallationSwitch = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.confirmSwitch",
		requires: "orgAdmin",
		schema: confirmDiscordSwitchSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.discordLifecycle.confirmSwitch",
				(): Promise<ConfirmChatInstallationSwitchResult> =>
					confirmChatInstallationSwitch(
						{
							organizationId,
							provider: "discord",
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
						value: { preview: result.freshPreview },
					}),
				);
			}

			const lifecycle = yield* dbService.query(
				"notificationChannels.discordLifecycle.confirmSwitch.reload",
				() => loadDiscordLifecycleState(dbService.db, organizationId),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				lifecycle,
			} satisfies ConfirmedDiscordSwitchData;
		}),
);

export const rotateDiscordInstallationCredentialsAction = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.rotate",
		requires: "orgAdmin",
		schema: rotateDiscordCredentialsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.discordLifecycle.rotate",
				(): Promise<RotateChatInstallationCredentialsResult> =>
					rotateDiscordInstallationCredentials(
						{
							organizationId,
							installationId: input.installationId,
							actorUserId: actor.userId,
							botToken: input.botToken,
							publicKey: input.publicKey,
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

			const lifecycle = yield* dbService.query(
				"notificationChannels.discordLifecycle.rotate.reload",
				() => loadDiscordLifecycleState(dbService.db, organizationId),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				lifecycle,
			} satisfies RotatedDiscordInstallationData;
		}),
);

export const revokeDiscordInstallationAction = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.revoke",
		requires: "orgAdmin",
		schema: revokeDiscordInstallationSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.discordLifecycle.revoke",
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

			const lifecycle = yield* dbService.query(
				"notificationChannels.discordLifecycle.revoke.reload",
				() => loadDiscordLifecycleState(dbService.db, organizationId),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				lifecycle,
			} satisfies RevokedDiscordInstallationData;
		}),
);

export const prepareDiscordInstallationRestore = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.prepareRestore",
		requires: "orgAdmin",
		schema: installationIdSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.discordLifecycle.prepareRestore",
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

			const lifecycle = yield* dbService.query(
				"notificationChannels.discordLifecycle.prepareRestore.reload",
				() => loadDiscordLifecycleState(dbService.db, organizationId, result.installationId),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				lifecycle,
			} satisfies PreparedDiscordRestoreData;
		}),
);

export const confirmDiscordInstallationRestore = organizationAction(
	{
		name: "notificationChannels.discordLifecycle.confirmRestore",
		requires: "orgAdmin",
		schema: confirmDiscordSwitchSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.discordLifecycle.confirmRestore",
				(): Promise<ConfirmChatInstallationRestoreResult> =>
					confirmChatInstallationRestore(
						{
							organizationId,
							provider: "discord",
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

			const lifecycle = yield* dbService.query(
				"notificationChannels.discordLifecycle.confirmRestore.reload",
				() => loadDiscordLifecycleState(dbService.db, organizationId),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				lifecycle,
			} satisfies ConfirmedDiscordSwitchData;
		}),
);
