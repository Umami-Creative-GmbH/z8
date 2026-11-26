"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	configureSlackCandidateCredentials,
	getSlackCandidateSetupView,
	prepareSlackCandidateInstallation,
	type SlackCandidateSetupView,
	sendSlackCandidateTestMessage,
} from "@/lib/chat-installations/slack-setup";
import { ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const saveCredentialsSchema = z.strictObject(
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
	"Slack credentials are required",
);

const sendPrivateTestSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		slackUserId: z
			.string({ error: "Slack member ID is required" })
			.trim()
			.min(1, "Slack member ID is required"),
	},
	"Test recipient details are required",
);

export interface SlackCandidateCredentialsInput {
	installationId: string;
	botToken: string;
	signingSecret: string;
}

export interface SlackCandidatePrivateTestInput {
	installationId: string;
	slackUserId: string;
}

export const getSlackCandidateSetup = organizationAction(
	{
		name: "notificationChannels.slackCandidate.get",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"notificationChannels.slackCandidate.get",
				(): Promise<SlackCandidateSetupView | null> =>
					getSlackCandidateSetupView(organizationId, { db: dbService.db }),
			);
		}),
);

export const prepareSlackCandidate = organizationAction(
	{
		name: "notificationChannels.slackCandidate.prepare",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const view = yield* dbService.query(
				"notificationChannels.slackCandidate.prepare",
				(): Promise<SlackCandidateSetupView> =>
					prepareSlackCandidateInstallation(
						{
							organizationId,
							actorUserId: actor.userId,
						},
						{ db: dbService.db },
					),
			);
			revalidatePath("/settings/notification-channels");
			return view;
		}),
);

export const saveAndVerifySlackCandidateCredentials = organizationAction(
	{
		name: "notificationChannels.slackCandidate.saveCredentials",
		requires: "orgAdmin",
		schema: saveCredentialsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.slackCandidate.saveCredentials",
				() =>
					configureSlackCandidateCredentials(
						{
							organizationId,
							actorUserId: actor.userId,
							installationId: input.installationId,
							botToken: input.botToken,
							signingSecret: input.signingSecret,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "error") {
				if (
					result.code === "slack_unavailable" ||
					result.code === "secret_store_unavailable" ||
					result.code === "credential_write_failed"
				) {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: result.code === "slack_unavailable" ? "slack" : "secret_store",
							operation: "saveAndVerifySlackCandidateCredentials",
							cause: { code: result.code },
						}),
					);
				}

				const field =
					result.code === "invalid_signing_secret_format"
						? "signingSecret"
						: result.code === "invalid_bot_token_format" ||
							  result.code === "invalid_bot_token" ||
							  result.code === "missing_slack_scope"
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

			revalidatePath("/settings/notification-channels");
			return result.view;
		}),
);

export const sendSlackCandidatePrivateTest = organizationAction(
	{
		name: "notificationChannels.slackCandidate.sendPrivateTest",
		requires: "orgAdmin",
		schema: sendPrivateTestSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.slackCandidate.sendPrivateTest",
				() =>
					sendSlackCandidateTestMessage(
						{
							organizationId,
							actorUserId: actor.userId,
							installationId: input.installationId,
							slackUserId: input.slackUserId,
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
							service: result.code === "secret_store_unavailable" ? "secret_store" : "slack",
							operation: "sendSlackCandidatePrivateTest",
							cause: { code: result.code },
						}),
					);
				}

				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						field: result.code === "invalid_slack_user_id" ? "slackUserId" : undefined,
						refusal: result.code,
					}),
				);
			}

			revalidatePath("/settings/notification-channels");
			return result.view;
		}),
);
