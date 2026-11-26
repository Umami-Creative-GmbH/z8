"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	type BeginChatInstallationRestoreResult,
	beginTeamsInstallationRestore,
	buildTeamsSwitchImpactPreview,
	type ChatEffectiveSettings,
	type ConfirmTeamsOrganizationSwitchResult,
	confirmTeamsInstallationRestore,
	confirmTeamsOrganizationSwitch,
	type RevokeChatInstallationResult,
	type RotateChatInstallationCredentialsResult,
	revokeLegacyTeamsTenantInstallation,
	rotateTeamsInstallationCredentials,
	type TeamsSwitchImpactPreview,
	type VerifyRestoredTeamsResult,
	verifyRestoredTeamsInstallation,
} from "@/lib/chat-installations";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";

const replacementSettingsSchema = z.strictObject({
	enableApprovals: z.boolean({ error: "Enable approvals must be a boolean" }),
	enableCommands: z.boolean({ error: "Enable commands must be a boolean" }),
	enableDailyDigest: z.boolean({ error: "Enable daily digest must be a boolean" }),
	enableEscalations: z.boolean({ error: "Enable escalations must be a boolean" }),
	digestTime: z
		.string({ error: "Digest time must use HH:mm format" })
		.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Digest time must use HH:mm format"),
	digestTimezone: z
		.string({ error: "Digest timezone is required" })
		.trim()
		.min(1, "Digest timezone is required")
		.refine(isValidIanaTimeZone, "Digest timezone must be a valid timezone"),
	escalationTimeoutHours: z
		.number({ error: "Escalation timeout must be at least 1 hour" })
		.int("Escalation timeout must be at least 1 hour")
		.min(1, "Escalation timeout must be at least 1 hour"),
});

const confirmTeamsSwitchSchema = z.strictObject(
	{
		candidateInstallationId: z
			.string({ error: "Candidate installation ID is required" })
			.uuid("Invalid candidate installation ID"),
		reviewedAffectedInstallationIds: z.array(z.string().uuid("Invalid affected installation ID")),
		reviewedCandidateCredentialRevisionId: z.string().uuid().nullable(),
		reviewedImpactDigest: z
			.string({ error: "Reviewed impact digest is required" })
			.regex(/^[a-f0-9]{64}$/, "Invalid impact digest"),
		acknowledgeUnreadyEmployees: z.boolean({
			error: "Acknowledgment must be a boolean",
		}),
		confirmedReplacementSettings: replacementSettingsSchema.nullable().optional(),
	},
	"Teams switch confirmation details are required",
);

const revokeTeamsTenantSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		reason: z.string().trim().max(240).optional(),
	},
	"Installation ID is required",
);

const rotateTeamsCredentialsSchema = z.strictObject(
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
	},
	"Teams rotation credentials are required",
);

const prepareTeamsRestoreSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
	},
	"Installation ID is required",
);

const verifyTeamsRestoreSchema = z.strictObject(
	{
		installationId: z
			.string({ error: "Installation ID is required" })
			.uuid("Invalid installation ID"),
		microsoftAppId: z.string().trim().optional(),
		microsoftTenantId: z.string().trim().optional(),
		microsoftAppPassword: z.string().trim().optional(),
		sendProactiveTest: z.boolean().optional(),
	},
	"Restore verification details are required",
);

export interface ConfirmTeamsSwitchActionInput {
	candidateInstallationId: string;
	reviewedAffectedInstallationIds: string[];
	reviewedCandidateCredentialRevisionId: string | null;
	reviewedImpactDigest: string;
	acknowledgeUnreadyEmployees: boolean;
	confirmedReplacementSettings?: ChatEffectiveSettings | null;
}

export type ConfirmedTeamsSwitchData = Extract<
	ConfirmTeamsOrganizationSwitchResult,
	{ kind: "switched" }
>;

export interface RevokeTeamsTenantActionInput {
	installationId: string;
	reason?: string;
}

export type RevokedTeamsTenantData = Extract<
	RevokeChatInstallationResult,
	{ kind: "revoked" | "already_revoked" }
> & {
	preview: TeamsSwitchImpactPreview;
};

export interface RotateTeamsCredentialsActionInput {
	installationId: string;
	microsoftAppId: string;
	microsoftTenantId: string;
	microsoftAppPassword: string;
}

export type RotatedTeamsCredentialsData = Extract<
	RotateChatInstallationCredentialsResult,
	{ kind: "rotated" }
> & {
	preview: TeamsSwitchImpactPreview;
};

export interface PrepareTeamsRestoreActionInput {
	installationId: string;
}

export type PreparedTeamsRestoreData = Extract<
	BeginChatInstallationRestoreResult,
	{ kind: "restore_started" }
> & {
	preview: TeamsSwitchImpactPreview;
};

export interface VerifyTeamsRestoreActionInput {
	installationId: string;
	microsoftAppId?: string;
	microsoftTenantId?: string;
	microsoftAppPassword?: string;
	sendProactiveTest?: boolean;
}

export type VerifiedTeamsRestoreData = Extract<
	VerifyRestoredTeamsResult,
	{ kind: "verified_step" }
>;

export const getTeamsSwitchImpactPreview = organizationAction(
	{
		name: "notificationChannels.teamsSwitch.preview",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"notificationChannels.teamsSwitch.preview",
				(): Promise<TeamsSwitchImpactPreview> =>
					buildTeamsSwitchImpactPreview(organizationId, null, { db: dbService.db }),
			);
		}),
);

export const confirmTeamsSwitch = organizationAction(
	{
		name: "notificationChannels.teamsSwitch.confirm",
		requires: "orgAdmin",
		schema: confirmTeamsSwitchSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.teamsSwitch.confirm",
				(): Promise<ConfirmTeamsOrganizationSwitchResult> =>
					confirmTeamsOrganizationSwitch(
						{
							organizationId,
							actorUserId: actor.userId,
							candidateInstallationId: input.candidateInstallationId,
							reviewedAffectedInstallationIds: input.reviewedAffectedInstallationIds,
							reviewedCandidateCredentialRevisionId: input.reviewedCandidateCredentialRevisionId,
							reviewedImpactDigest: input.reviewedImpactDigest,
							acknowledgeUnreadyEmployees: input.acknowledgeUnreadyEmployees,
							confirmedReplacementSettings: input.confirmedReplacementSettings ?? null,
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

			revalidatePath("/settings/notification-channels");
			return result satisfies ConfirmedTeamsSwitchData;
		}),
);

export const revokeTeamsTenant = organizationAction(
	{
		name: "notificationChannels.teamsSwitch.revokeTenant",
		requires: "orgAdmin",
		schema: revokeTeamsTenantSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.teamsSwitch.revokeTenant",
				(): Promise<RevokeChatInstallationResult> =>
					revokeLegacyTeamsTenantInstallation(organizationId, input.installationId, actor.userId, {
						db: dbService.db,
						reason: input.reason,
					}),
			);

			if (result.kind === "refused") {
				return yield* Effect.fail(
					new ValidationError({
						message: result.message,
						refusal: result.code,
					}),
				);
			}

			const preview = yield* dbService.query(
				"notificationChannels.teamsSwitch.revokeTenant.reload",
				() => buildTeamsSwitchImpactPreview(organizationId, null, { db: dbService.db }),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				preview,
			} satisfies RevokedTeamsTenantData;
		}),
);

export const rotateTeamsCredentials = organizationAction(
	{
		name: "notificationChannels.teamsSwitch.rotateCredentials",
		requires: "orgAdmin",
		schema: rotateTeamsCredentialsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.teamsSwitch.rotateCredentials",
				(): Promise<RotateChatInstallationCredentialsResult> =>
					rotateTeamsInstallationCredentials(
						{
							organizationId,
							installationId: input.installationId,
							actorUserId: actor.userId,
							microsoftAppId: input.microsoftAppId,
							microsoftTenantId: input.microsoftTenantId,
							microsoftAppPassword: input.microsoftAppPassword,
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

			const preview = yield* dbService.query(
				"notificationChannels.teamsSwitch.rotateCredentials.reload",
				() => buildTeamsSwitchImpactPreview(organizationId, null, { db: dbService.db }),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				preview,
			} satisfies RotatedTeamsCredentialsData;
		}),
);

export const prepareTeamsRestore = organizationAction(
	{
		name: "notificationChannels.teamsSwitch.prepareRestore",
		requires: "orgAdmin",
		schema: prepareTeamsRestoreSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.teamsSwitch.prepareRestore",
				(): Promise<BeginChatInstallationRestoreResult> =>
					beginTeamsInstallationRestore(
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

			const preview = yield* dbService.query(
				"notificationChannels.teamsSwitch.prepareRestore.reload",
				() =>
					buildTeamsSwitchImpactPreview(organizationId, result.installationId, {
						db: dbService.db,
					}),
			);

			revalidatePath("/settings/notification-channels");
			return {
				...result,
				preview,
			} satisfies PreparedTeamsRestoreData;
		}),
);

export const verifyTeamsRestore = organizationAction(
	{
		name: "notificationChannels.teamsSwitch.verifyRestore",
		requires: "orgAdmin",
		schema: verifyTeamsRestoreSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.teamsSwitch.verifyRestore",
				(): Promise<VerifyRestoredTeamsResult> =>
					verifyRestoredTeamsInstallation(
						{
							organizationId,
							installationId: input.installationId,
							actorUserId: actor.userId,
							microsoftAppId: input.microsoftAppId,
							microsoftTenantId: input.microsoftTenantId,
							microsoftAppPassword: input.microsoftAppPassword,
							sendProactiveTest: input.sendProactiveTest,
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

			revalidatePath("/settings/notification-channels");
			return result satisfies VerifiedTeamsRestoreData;
		}),
);

export const confirmTeamsRestore = organizationAction(
	{
		name: "notificationChannels.teamsSwitch.confirmRestore",
		requires: "orgAdmin",
		schema: confirmTeamsSwitchSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.teamsSwitch.confirmRestore",
				(): Promise<ConfirmTeamsOrganizationSwitchResult> =>
					confirmTeamsInstallationRestore(
						{
							organizationId,
							actorUserId: actor.userId,
							candidateInstallationId: input.candidateInstallationId,
							reviewedAffectedInstallationIds: input.reviewedAffectedInstallationIds,
							reviewedCandidateCredentialRevisionId: input.reviewedCandidateCredentialRevisionId,
							reviewedImpactDigest: input.reviewedImpactDigest,
							acknowledgeUnreadyEmployees: input.acknowledgeUnreadyEmployees,
							confirmedReplacementSettings: input.confirmedReplacementSettings ?? null,
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

			revalidatePath("/settings/notification-channels");
			return result satisfies ConfirmedTeamsSwitchData;
		}),
);
