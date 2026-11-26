"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TeamsCandidateSetupView } from "@/lib/chat-installations/teams-app-package";
import {
	configureTeamsCandidateCredentials,
	getTeamsCandidateSetupView,
	prepareTeamsCandidateInstallation,
	sendTeamsCandidateProactiveTestMessage,
} from "@/lib/chat-installations/teams-setup";
import { ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const saveTeamsCredentialsSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		microsoftAppId: z
			.string({ error: "Microsoft App ID is required" })
			.trim()
			.min(1, "Microsoft App ID is required"),
		microsoftTenantId: z
			.string({ error: "Microsoft Entra Tenant ID is required" })
			.trim()
			.min(1, "Microsoft Entra Tenant ID is required"),
		microsoftAppPassword: z
			.string({ error: "Microsoft App Password is required" })
			.trim()
			.min(1, "Microsoft App Password is required"),
		tenantDisplayName: z.string().trim().max(120).optional(),
	},
	"Teams single-tenant credentials are required",
);

const sendTeamsProactiveTestSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
	},
	"Installation ID is required",
);

export interface TeamsCandidateCredentialsInput {
	installationId: string;
	microsoftAppId: string;
	microsoftTenantId: string;
	microsoftAppPassword: string;
	tenantDisplayName?: string;
}

export interface TeamsCandidateProactiveTestInput {
	installationId: string;
}

export const getTeamsCandidateSetup = organizationAction(
	{
		name: "notificationChannels.teamsCandidate.get",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"notificationChannels.teamsCandidate.get",
				(): Promise<TeamsCandidateSetupView | null> =>
					getTeamsCandidateSetupView(organizationId, {
						db: dbService.db,
						actorUserId: actor.userId,
					}),
			);
		}),
);

export const prepareTeamsCandidate = organizationAction(
	{
		name: "notificationChannels.teamsCandidate.prepare",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const view = yield* dbService.query(
				"notificationChannels.teamsCandidate.prepare",
				(): Promise<TeamsCandidateSetupView> =>
					prepareTeamsCandidateInstallation(
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

export const saveTeamsCandidateCredentials = organizationAction(
	{
		name: "notificationChannels.teamsCandidate.saveCredentials",
		requires: "orgAdmin",
		schema: saveTeamsCredentialsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.teamsCandidate.saveCredentials",
				() =>
					configureTeamsCandidateCredentials(
						{
							organizationId,
							actorUserId: actor.userId,
							installationId: input.installationId,
							microsoftAppId: input.microsoftAppId,
							microsoftTenantId: input.microsoftTenantId,
							microsoftAppPassword: input.microsoftAppPassword,
							tenantDisplayName: input.tenantDisplayName,
						},
						{ db: dbService.db },
					),
			);

			if (result.kind === "error") {
				if (
					result.code === "secret_store_unavailable" ||
					result.code === "credential_write_failed"
				) {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: "secret_store",
							operation: "saveTeamsCandidateCredentials",
							cause: { code: result.code },
						}),
					);
				}

				const field =
					result.code === "invalid_app_id_format" || result.code === "app_claimed_by_other_org"
						? "microsoftAppId"
						: result.code === "invalid_tenant_id_format" ||
							  result.code === "tenant_claimed_by_other_org"
							? "microsoftTenantId"
							: result.code === "invalid_app_password_format"
								? "microsoftAppPassword"
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

export const sendTeamsCandidateProactiveTest = organizationAction(
	{
		name: "notificationChannels.teamsCandidate.sendProactiveTest",
		requires: "orgAdmin",
		schema: sendTeamsProactiveTestSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.teamsCandidate.sendProactiveTest",
				() =>
					sendTeamsCandidateProactiveTestMessage(
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
					result.code === "private_delivery_failed"
				) {
					return yield* Effect.fail(
						new ExternalServiceError({
							message: result.message,
							service: result.code === "secret_store_unavailable" ? "secret_store" : "teams",
							operation: "sendTeamsCandidateProactiveTest",
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

			revalidatePath("/settings/notification-channels");
			return result.view;
		}),
);
