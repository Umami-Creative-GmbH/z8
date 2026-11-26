"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	type BeginChatInstallationRestoreResult,
	beginChatInstallationRestore,
	buildChatSwitchImpactPreview,
	type ChatInstallationRecoveryState,
	type ChatRecoveryDb,
	type ChatSwitchImpactPreview,
	type ConfirmChatInstallationRestoreResult,
	type ConfirmChatInstallationSwitchResult,
	confirmChatInstallationRestore,
	confirmChatInstallationSwitch,
	getChatInstallationRecoveryState,
	type RevokeChatInstallationResult,
	type RotateChatInstallationCredentialsResult,
	revokeChatInstallation,
} from "@/lib/chat-installations";
import {
	configureTelegramCandidateCredentials,
	getTelegramCandidateSetupView,
	prepareTelegramCandidateInstallation,
	retryTelegramCandidateCommandRegistration,
	retryTelegramCandidateWebhookRegistration,
	rotateTelegramInstallationCredentials,
	sendTelegramCandidateTestMessage,
	type TelegramCandidateSetupView,
} from "@/lib/chat-installations/telegram-setup";
import { ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const installationIdSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
	},
	"Installation ID is required",
);

const saveTelegramCredentialsSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		botToken: z.string({ error: "Bot token is required" }).trim().min(1, "Bot token is required"),
	},
	"Telegram bot token is required",
);

const sendTelegramPrivateTestSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		chatId: z.string().trim().max(32).optional(),
	},
	"Telegram test details are required",
);

const confirmTelegramSwitchSchema = z.strictObject(
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

const revokeTelegramSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		reason: z.string().trim().max(240).optional(),
	},
	"Installation ID is required",
);

export interface TelegramLifecycleState {
	candidateSetup: TelegramCandidateSetupView | null;
	switchPreview: ChatSwitchImpactPreview;
	recoveryState: ChatInstallationRecoveryState;
}

export interface SaveTelegramCredentialsActionInput {
	installationId: string;
	botToken: string;
}

export interface SendTelegramPrivateTestActionInput {
	installationId: string;
	chatId?: string;
}

export interface ConfirmTelegramSwitchActionInput {
	candidateInstallationId: string;
	reviewedCurrentInstallationId: string | null;
	reviewedCurrentCredentialRevisionId: string | null;
	reviewedCandidateCredentialRevisionId: string | null;
	reviewedImpactDigest: string;
	acknowledgeUnreadyEmployees: boolean;
}

export interface RevokeTelegramInstallationActionInput {
	installationId: string;
	reason?: string;
}

async function loadTelegramLifecycleSnapshot(
	organizationId: string,
	db: ChatRecoveryDb,
	restoreCandidateId?: string | null,
): Promise<TelegramLifecycleState> {
	const [candidateSetup, switchPreview, recoveryState] = await Promise.all([
		getTelegramCandidateSetupView(organizationId, { db }),
		buildChatSwitchImpactPreview({ organizationId, provider: "telegram" }, { db }),
		getChatInstallationRecoveryState(
			{ organizationId, provider: "telegram", restoreCandidateId },
			{ db },
		),
	]);
	return { candidateSetup, switchPreview, recoveryState };
}

export const getTelegramLifecycleState = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.get",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("notificationChannels.telegramLifecycle.get", () =>
				loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
		}),
);

export const prepareTelegramCandidate = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.prepare",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("notificationChannels.telegramLifecycle.prepare", () =>
				prepareTelegramCandidateInstallation(
					{ organizationId, actorUserId: actor.userId },
					{ db: dbService.db },
				),
			);
			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.prepare.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);

export const saveTelegramCandidateCredentials = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.saveCredentials",
		requires: "orgAdmin",
		schema: saveTelegramCredentialsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.telegramLifecycle.saveCredentials",
				() =>
					configureTelegramCandidateCredentials(
						{
							organizationId,
							actorUserId: actor.userId,
							installationId: input.installationId,
							botToken: input.botToken,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "error") {
				if (
					result.code === "telegram_unavailable" ||
					result.code === "secret_store_unavailable" ||
					result.code === "credential_write_failed"
				) {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: result.code === "telegram_unavailable" ? "telegram" : "secret_store",
							operation: "saveTelegramCandidateCredentials",
							cause: { code: result.code },
						}),
					);
				}

				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						field:
							result.code === "invalid_bot_token_format" || result.code === "invalid_bot_token"
								? "botToken"
								: undefined,
						refusal: result.code,
					}),
				);
			}

			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.saveCredentials.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);

export const retryTelegramCandidateWebhook = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.retryWebhook",
		requires: "orgAdmin",
		schema: installationIdSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.telegramLifecycle.retryWebhook",
				() =>
					retryTelegramCandidateWebhookRegistration(
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
					result.code === "webhook_registration_failed"
				) {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: result.code === "secret_store_unavailable" ? "secret_store" : "telegram",
							operation: "retryTelegramCandidateWebhook",
							cause: { code: result.code },
						}),
					);
				}
				return yield* Effect.fail(
					new ValidationError({ message: result.message, refusal: result.code }),
				);
			}

			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.retryWebhook.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);

export const retryTelegramCandidateCommands = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.retryCommands",
		requires: "orgAdmin",
		schema: installationIdSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.telegramLifecycle.retryCommands",
				() =>
					retryTelegramCandidateCommandRegistration(
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
							service: result.code === "secret_store_unavailable" ? "secret_store" : "telegram",
							operation: "retryTelegramCandidateCommands",
							cause: { code: result.code },
						}),
					);
				}
				return yield* Effect.fail(
					new ValidationError({ message: result.message, refusal: result.code }),
				);
			}

			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.retryCommands.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);

export const sendTelegramCandidatePrivateTest = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.sendPrivateTest",
		requires: "orgAdmin",
		schema: sendTelegramPrivateTestSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.telegramLifecycle.sendPrivateTest",
				() =>
					sendTelegramCandidateTestMessage(
						{
							organizationId,
							actorUserId: actor.userId,
							installationId: input.installationId,
							chatId: input.chatId,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "error") {
				if (
					result.code === "secret_store_unavailable" ||
					result.code === "private_delivery_failed"
				) {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: result.code === "secret_store_unavailable" ? "secret_store" : "telegram",
							operation: "sendTelegramCandidatePrivateTest",
							cause: { code: result.code },
						}),
					);
				}
				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						field: result.code === "invalid_chat_id" ? "chatId" : undefined,
						refusal: result.code,
					}),
				);
			}

			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.sendPrivateTest.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);

export const confirmTelegramInstallationSwitch = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.confirmSwitch",
		requires: "orgAdmin",
		schema: confirmTelegramSwitchSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.telegramLifecycle.confirmSwitch",
				(): Promise<ConfirmChatInstallationSwitchResult> =>
					confirmChatInstallationSwitch(
						{
							organizationId,
							provider: "telegram",
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

			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.confirmSwitch.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);

export const rotateTelegramCredentials = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.rotate",
		requires: "orgAdmin",
		schema: saveTelegramCredentialsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.telegramLifecycle.rotate",
				(): Promise<RotateChatInstallationCredentialsResult> =>
					rotateTelegramInstallationCredentials(
						{
							organizationId,
							installationId: input.installationId,
							actorUserId: actor.userId,
							botToken: input.botToken,
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

			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.rotate.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);

export const revokeTelegramInstallation = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.revoke",
		requires: "orgAdmin",
		schema: revokeTelegramSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.telegramLifecycle.revoke",
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

			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.revoke.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);

export const prepareTelegramRestore = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.prepareRestore",
		requires: "orgAdmin",
		schema: installationIdSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.telegramLifecycle.prepareRestore",
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

			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.prepareRestore.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db, result.installationId),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);

export const confirmTelegramRestore = organizationAction(
	{
		name: "notificationChannels.telegramLifecycle.confirmRestore",
		requires: "orgAdmin",
		schema: confirmTelegramSwitchSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.telegramLifecycle.confirmRestore",
				(): Promise<ConfirmChatInstallationRestoreResult> =>
					confirmChatInstallationRestore(
						{
							organizationId,
							provider: "telegram",
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

			const state = yield* dbService.query(
				"notificationChannels.telegramLifecycle.confirmRestore.reload",
				() => loadTelegramLifecycleSnapshot(organizationId, dbService.db),
			);
			revalidatePath("/settings/notification-channels");
			return state;
		}),
);
