"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	CHAT_INSTALLATION_PROVIDERS,
	type ChatSwitchImpactPreview,
	type ConfirmChatInstallationSwitchResult,
	type ProviderCapabilityDisclosure,
	buildChatSwitchImpactPreview,
	confirmChatInstallationSwitch,
	getProviderCapabilityDisclosure as loadProviderCapabilityDisclosure,
} from "@/lib/chat-installations";
import { ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const confirmSlackSwitchSchema = z.strictObject(
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

const capabilityDisclosureSchema = z.strictObject({
	provider: z.enum(CHAT_INSTALLATION_PROVIDERS),
});

export interface ConfirmSlackSwitchActionInput {
	candidateInstallationId: string;
	reviewedCurrentInstallationId: string | null;
	reviewedCurrentCredentialRevisionId: string | null;
	reviewedCandidateCredentialRevisionId: string | null;
	reviewedImpactDigest: string;
	acknowledgeUnreadyEmployees: boolean;
}

export type ConfirmedSlackSwitchData = Extract<
	ConfirmChatInstallationSwitchResult,
	{ kind: "switched" }
>;

export const getSlackSwitchImpactPreview = organizationAction(
	{
		name: "notificationChannels.slackSwitch.preview",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"notificationChannels.slackSwitch.preview",
				(): Promise<ChatSwitchImpactPreview> =>
					buildChatSwitchImpactPreview(
						{
							organizationId,
							provider: "slack",
						},
						{ db: dbService.db },
					),
			);
		}),
);

export const confirmSlackInstallationSwitch = organizationAction(
	{
		name: "notificationChannels.slackSwitch.confirm",
		requires: "orgAdmin",
		schema: confirmSlackSwitchSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query(
				"notificationChannels.slackSwitch.confirm",
				(): Promise<ConfirmChatInstallationSwitchResult> =>
					confirmChatInstallationSwitch(
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
						value: { preview: result.freshPreview },
					}),
				);
			}

			revalidatePath("/settings/notification-channels");
			return result satisfies ConfirmedSlackSwitchData;
		}),
);

export const getProviderCapabilityDisclosure = organizationAction(
	{
		name: "notificationChannels.capabilities.get",
		requires: "orgAdmin",
		schema: capabilityDisclosureSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"notificationChannels.capabilities.get",
				(): Promise<ProviderCapabilityDisclosure> =>
					loadProviderCapabilityDisclosure(organizationId, input.provider, {
						db: dbService.db,
					}),
			);
		}),
);
