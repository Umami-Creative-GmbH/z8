import { and, asc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	type ChatInstallationStatus,
	type ChatOwnershipClaimKind,
	type ChatVerificationEvidence,
	type ChatVerificationState,
	chatInstallation,
	chatInstallationCredentialRevision,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import {
	openConversationWithOutcome,
	postMessageWithOutcome,
	type VerifySlackBotMetadataResult,
	verifySlackBotMetadata,
} from "@/lib/slack/api";
import type { SlackCallFailure } from "@/lib/slack/delivery-outcome";
import { isSecretStoreUnavailableError, type SecretStoreProviderKind } from "@/lib/vault";
import { acquireExternalOwnershipClaim } from "./backfill";
import {
	type CredentialRevisionRepository,
	readInstallationCredentialRevision,
	storeInstallationCredentialRevision,
} from "./credential-revisions";
import { upsertInstallationConversation } from "./inventory";
import {
	computeExpiryIso,
	defaultRecordAudit,
	generateRouteId,
	isFreshTimestamp,
	resolveAppUrl,
} from "./setup-utils";
import type { ChatInstallationsDb } from "./types";

/**
 * Freshness window for candidate Slack verification proofs (signed app+workspace event
 * and synthetic private DM delivery). Older proofs expire and require re-verification.
 */
export const SLACK_VERIFICATION_FRESHNESS_MS = 24 * 60 * 60 * 1000;

export const SLACK_BOT_TOKEN_PREFIX = "xoxb-";

export type SlackVerificationStepStatus = "passed" | "pending" | "failed" | "expired";

export interface SlackVerificationStepView {
	status: SlackVerificationStepStatus;
	verifiedAt: string | null;
	expiresAt: string | null;
	detail: string | null;
	failureCode: string | null;
}

export interface SlackCandidateCallbackUrls {
	eventsUrl: string;
	interactionsUrl: string;
	commandsUrl: string;
}

export interface SlackAppManifestDocument {
	display_information: {
		name: string;
		description: string;
		background_color: string;
	};
	features: {
		bot_user: {
			display_name: string;
			always_online: boolean;
		};
		slash_commands: Array<{
			command: string;
			url: string;
			description: string;
			usage_hint: string;
			should_escape: boolean;
		}>;
	};
	oauth_config: {
		scopes: {
			bot: string[];
		};
	};
	settings: {
		event_subscriptions: {
			request_url: string;
			bot_events: string[];
		};
		interactivity: {
			is_enabled: boolean;
			request_url: string;
		};
		org_deploy_enabled: boolean;
		socket_mode_enabled: boolean;
		token_rotation_enabled: boolean;
	};
}

export interface GeneratedSlackAppManifest {
	manifest: SlackAppManifestDocument;
	json: string;
	yaml: string;
	urls: SlackCandidateCallbackUrls;
}

export interface SlackCandidateSetupView {
	installationId: string;
	organizationId: string;
	routeId: string;
	status: ChatInstallationStatus;
	verificationState: ChatVerificationState;
	readyForSwitch: boolean;
	externalAppId: string | null;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalSpaceId: string | null;
	externalSpaceName: string | null;
	hasStoredCredentials: boolean;
	credentialRevisionNumber: number | null;
	urls: SlackCandidateCallbackUrls;
	manifestJson: string;
	manifestYaml: string;
	steps: {
		credentials: SlackVerificationStepView;
		identity: SlackVerificationStepView;
		signedEvent: SlackVerificationStepView;
		privateTest: SlackVerificationStepView;
	};
	lastVerifiedAt: string | null;
	updatedAt: string;
}

export interface SlackCandidateInstallationRecord {
	id: string;
	organizationId: string;
	provider: "slack";
	credentialSource: "organization_owned" | "deployment_managed";
	status: ChatInstallationStatus;
	routeId: string;
	externalAppId: string | null;
	externalBotId: string | null;
	externalBotUsername: string | null;
	externalDisplayName: string | null;
	externalSpaceId: string | null;
	externalSpaceName: string | null;
	receiverScope: string | null;
	spaceClaimId: string | null;
	botClaimId: string | null;
	activeCredentialRevisionId: string | null;
	verificationState: ChatVerificationState;
	verificationEvidence: ChatVerificationEvidence | null;
	lastVerifiedAt: Date | null;
	retirementDeadlineAt?: Date | null;
	retiredAt?: Date | null;
	revokedAt?: Date | null;
	endpointGeneration: number;
	createdByUserId: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface SlackSetupRepository {
	findCandidateByOrg(organizationId: string): Promise<SlackCandidateInstallationRecord | null>;
	findCandidateById(
		organizationId: string,
		installationId: string,
	): Promise<SlackCandidateInstallationRecord | null>;
	findInstallationByRouteId(routeId: string): Promise<SlackCandidateInstallationRecord | null>;
	insertCandidate(input: {
		organizationId: string;
		routeId: string;
		createdByUserId: string | null;
	}): Promise<SlackCandidateInstallationRecord>;
	updateCandidate(
		organizationId: string,
		installationId: string,
		patch: Partial<
			Pick<
				SlackCandidateInstallationRecord,
				| "externalAppId"
				| "externalBotId"
				| "externalBotUsername"
				| "externalDisplayName"
				| "externalSpaceId"
				| "externalSpaceName"
				| "receiverScope"
				| "spaceClaimId"
				| "botClaimId"
				| "activeCredentialRevisionId"
				| "verificationState"
				| "verificationEvidence"
				| "lastVerifiedAt"
			>
		>,
	): Promise<SlackCandidateInstallationRecord>;
	acquireClaim(input: {
		organizationId: string;
		claimKind: ChatOwnershipClaimKind;
		externalId: string;
		verifiedAt: Date;
	}): Promise<{ kind: "acquired"; claimId: string } | { kind: "conflict" }>;
	upsertCandidateConversation(input: {
		organizationId: string;
		installationId: string;
		userId: string;
		externalUserId: string;
		externalConversationId: string;
		reachabilityStatus: "reachable";
		verifiedAt: Date;
	}): Promise<void>;
	getRevisionNumber(
		organizationId: string,
		installationId: string,
		revisionId: string,
	): Promise<number | null>;
}

export type SendSlackPrivateDmResult =
	| { kind: "ok"; channelId: string; messageTs: string }
	| { kind: "failed"; code: string; message: string };

export interface SlackSetupAuditEvent {
	action: AuditAction;
	actorId: string;
	organizationId: string;
	targetId: string;
	metadata: Record<string, unknown>;
}

export interface SlackSetupRuntimeDeps {
	db?: ChatInstallationsDb;
	repository?: SlackSetupRepository;
	revisionRepository?: CredentialRevisionRepository;
	storeSecret?: (organizationId: string, key: string, value: string) => Promise<void>;
	readSecret?: (organizationId: string, key: string) => Promise<string | null>;
	deleteSecret?: (organizationId: string, key: string) => Promise<void>;
	secretStoreProvider?: SecretStoreProviderKind;
	verifyBotMetadata?: (botToken: string) => Promise<VerifySlackBotMetadataResult>;
	sendPrivateDm?: (
		botToken: string,
		input: { slackUserId: string; text: string },
	) => Promise<SendSlackPrivateDmResult>;
	recordAudit?: (event: SlackSetupAuditEvent) => Promise<void>;
	appUrl?: string;
	verificationTtlMs?: number;
	now?: () => Date;
}

function yamlEscape(value: string): string {
	return JSON.stringify(value);
}

/**
 * Generates a Slack App Manifest (JSON + YAML) with dedicated non-secret `routeId`-scoped
 * callback URLs and the bot scopes/events required for Z8.
 */
export function generateSlackAppManifest(input: {
	routeId: string;
	appUrl?: string;
	organizationName?: string | null;
}): GeneratedSlackAppManifest {
	const baseUrl = resolveAppUrl(input.appUrl);
	const routeSegment = encodeURIComponent(input.routeId);
	const urls: SlackCandidateCallbackUrls = {
		eventsUrl: `${baseUrl}/api/slack/installations/${routeSegment}/events`,
		interactionsUrl: `${baseUrl}/api/slack/installations/${routeSegment}/interactions`,
		commandsUrl: `${baseUrl}/api/slack/installations/${routeSegment}/commands`,
	};

	const rawName = input.organizationName?.trim()
		? `Z8 (${input.organizationName.trim()})`
		: "Z8 Workforce";
	const appName = rawName.length > 35 ? `${rawName.slice(0, 32)}...` : rawName;

	const manifest: SlackAppManifestDocument = {
		display_information: {
			name: appName,
			description: "Z8 time tracking, notifications, and approval review links",
			background_color: "#0f172a",
		},
		features: {
			bot_user: {
				display_name: "Z8",
				always_online: false,
			},
			slash_commands: [
				{
					command: "/z8",
					url: urls.commandsUrl,
					description: "Z8 time tracking and approvals",
					usage_hint: "help | status | clockin | clockout",
					should_escape: false,
				},
			],
		},
		oauth_config: {
			scopes: {
				bot: [
					"chat:write",
					"im:read",
					"im:write",
					"im:history",
					"commands",
					"users:read",
					"app_mentions:read",
				],
			},
		},
		settings: {
			event_subscriptions: {
				request_url: urls.eventsUrl,
				bot_events: ["message.im", "app_mention"],
			},
			interactivity: {
				is_enabled: true,
				request_url: urls.interactionsUrl,
			},
			org_deploy_enabled: false,
			socket_mode_enabled: false,
			token_rotation_enabled: false,
		},
	};

	const botScopesYaml = manifest.oauth_config.scopes.bot
		.map((scope) => `      - ${scope}`)
		.join("\n");
	const botEventsYaml = manifest.settings.event_subscriptions.bot_events
		.map((event) => `      - ${event}`)
		.join("\n");

	const yaml = [
		"display_information:",
		`  name: ${yamlEscape(manifest.display_information.name)}`,
		`  description: ${yamlEscape(manifest.display_information.description)}`,
		`  background_color: ${yamlEscape(manifest.display_information.background_color)}`,
		"features:",
		"  bot_user:",
		`    display_name: ${yamlEscape(manifest.features.bot_user.display_name)}`,
		`    always_online: ${String(manifest.features.bot_user.always_online)}`,
		"  slash_commands:",
		`    - command: ${yamlEscape(manifest.features.slash_commands[0].command)}`,
		`      url: ${yamlEscape(manifest.features.slash_commands[0].url)}`,
		`      description: ${yamlEscape(manifest.features.slash_commands[0].description)}`,
		`      usage_hint: ${yamlEscape(manifest.features.slash_commands[0].usage_hint)}`,
		`      should_escape: ${String(manifest.features.slash_commands[0].should_escape)}`,
		"oauth_config:",
		"  scopes:",
		"    bot:",
		botScopesYaml,
		"settings:",
		"  event_subscriptions:",
		`    request_url: ${yamlEscape(manifest.settings.event_subscriptions.request_url)}`,
		"    bot_events:",
		botEventsYaml,
		"  interactivity:",
		`    is_enabled: ${String(manifest.settings.interactivity.is_enabled)}`,
		`    request_url: ${yamlEscape(manifest.settings.interactivity.request_url)}`,
		`  org_deploy_enabled: ${String(manifest.settings.org_deploy_enabled)}`,
		`  socket_mode_enabled: ${String(manifest.settings.socket_mode_enabled)}`,
		`  token_rotation_enabled: ${String(manifest.settings.token_rotation_enabled)}`,
	].join("\n");

	return {
		manifest,
		json: JSON.stringify(manifest, null, 2),
		yaml,
		urls,
	};
}

/**
 * Evaluates step-by-step readiness for a candidate Slack installation.
 * Marks `readyForSwitch = true` ONLY when:
 * 1) Credentials & Slack bot metadata identity are verified for the active revision,
 * 2) A fresh signed app-and-workspace inbound event was verified for the active revision, AND
 * 3) A fresh synthetic private DM test succeeded for the active revision.
 */
export function computeSlackCandidateSetupStatus(
	installation: Pick<
		SlackCandidateInstallationRecord,
		| "activeCredentialRevisionId"
		| "externalAppId"
		| "externalBotId"
		| "externalSpaceId"
		| "externalSpaceName"
		| "verificationEvidence"
	>,
	now: Date = new Date(),
	ttlMs: number = SLACK_VERIFICATION_FRESHNESS_MS,
): {
	readyForSwitch: boolean;
	effectiveVerificationState: ChatVerificationState;
	steps: SlackCandidateSetupView["steps"];
} {
	const evidence = installation.verificationEvidence;
	const activeRevId = installation.activeCredentialRevisionId;

	const credentialsPassed = Boolean(activeRevId);
	const credentialsStep: SlackVerificationStepView = credentialsPassed
		? {
				status: "passed",
				verifiedAt: evidence?.identityVerifiedAt ?? null,
				expiresAt: null,
				detail: null,
				failureCode: null,
			}
		: evidence?.lastFailureStep === "credentials"
			? {
					status: "failed",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: evidence.lastFailureCode ?? "credential_write_failed",
				}
			: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				};

	const identityPassed = Boolean(
		activeRevId &&
		installation.externalAppId &&
		installation.externalSpaceId &&
		installation.externalBotId &&
		evidence?.identityVerifiedAt &&
		evidence.identityRevisionId === activeRevId,
	);
	const identityStep: SlackVerificationStepView = identityPassed
		? {
				status: "passed",
				verifiedAt: evidence?.identityVerifiedAt ?? null,
				expiresAt: null,
				detail: `${installation.externalAppId} / ${installation.externalSpaceName ?? installation.externalSpaceId}`,
				failureCode: null,
			}
		: evidence?.lastFailureStep === "identity"
			? {
					status: "failed",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: evidence.lastFailureCode ?? "identity_mismatch",
				}
			: {
					status: "pending",
					verifiedAt: null,
					expiresAt: null,
					detail: null,
					failureCode: null,
				};

	const signedEventMatchesRev = Boolean(
		activeRevId &&
		evidence?.signedEventVerifiedAt &&
		evidence.signedEventRevisionId === activeRevId,
	);
	const signedEventFresh =
		signedEventMatchesRev &&
		isFreshTimestamp(evidence?.signedEventVerifiedAt, evidence?.signedEventExpiresAt, now, ttlMs);
	const signedEventStep: SlackVerificationStepView = signedEventFresh
		? {
				status: "passed",
				verifiedAt: evidence?.signedEventVerifiedAt ?? null,
				expiresAt: evidence?.signedEventExpiresAt ?? null,
				detail: evidence?.signedEventType ?? null,
				failureCode: null,
			}
		: signedEventMatchesRev
			? {
					status: "expired",
					verifiedAt: evidence?.signedEventVerifiedAt ?? null,
					expiresAt: evidence?.signedEventExpiresAt ?? null,
					detail: evidence?.signedEventType ?? null,
					failureCode: "signed_event_expired",
				}
			: evidence?.lastFailureStep === "signed_event"
				? {
						status: "failed",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: evidence.lastFailureCode ?? "signed_event_mismatch",
					}
				: {
						status: "pending",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: null,
					};

	const privateTestMatchesRev = Boolean(
		activeRevId &&
		evidence?.privateDeliveryVerifiedAt &&
		evidence.privateDeliveryRevisionId === activeRevId,
	);
	const privateTestFresh =
		privateTestMatchesRev &&
		isFreshTimestamp(
			evidence?.privateDeliveryVerifiedAt,
			evidence?.privateDeliveryExpiresAt,
			now,
			ttlMs,
		);
	const privateTestStep: SlackVerificationStepView = privateTestFresh
		? {
				status: "passed",
				verifiedAt: evidence?.privateDeliveryVerifiedAt ?? null,
				expiresAt: evidence?.privateDeliveryExpiresAt ?? null,
				detail: evidence?.privateDeliveryTargetUserId ?? null,
				failureCode: null,
			}
		: privateTestMatchesRev
			? {
					status: "expired",
					verifiedAt: evidence?.privateDeliveryVerifiedAt ?? null,
					expiresAt: evidence?.privateDeliveryExpiresAt ?? null,
					detail: evidence?.privateDeliveryTargetUserId ?? null,
					failureCode: "private_test_expired",
				}
			: evidence?.lastFailureStep === "private_test"
				? {
						status: "failed",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: evidence.lastFailureCode ?? "private_test_failed",
					}
				: {
						status: "pending",
						verifiedAt: null,
						expiresAt: null,
						detail: null,
						failureCode: null,
					};

	const readyForSwitch =
		credentialsStep.status === "passed" &&
		identityStep.status === "passed" &&
		signedEventStep.status === "passed" &&
		privateTestStep.status === "passed";

	let effectiveVerificationState: ChatVerificationState = "unverified";
	if (readyForSwitch) {
		effectiveVerificationState = "verified";
	} else if (signedEventStep.status === "expired" || privateTestStep.status === "expired") {
		effectiveVerificationState = "expired";
	} else if (
		credentialsStep.status === "failed" ||
		identityStep.status === "failed" ||
		signedEventStep.status === "failed" ||
		privateTestStep.status === "failed"
	) {
		effectiveVerificationState = "failed";
	} else if (credentialsStep.status === "passed" || identityStep.status === "passed") {
		effectiveVerificationState = "pending";
	}

	return {
		readyForSwitch,
		effectiveVerificationState,
		steps: {
			credentials: credentialsStep,
			identity: identityStep,
			signedEvent: signedEventStep,
			privateTest: privateTestStep,
		},
	};
}

function createDrizzleSlackSetupRepository(db: ChatInstallationsDb): SlackSetupRepository {
	return {
		async findCandidateByOrg(organizationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "slack"),
						eq(chatInstallation.status, "candidate"),
					),
				)
				.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id))
				.limit(1);
			return (row as SlackCandidateInstallationRecord | undefined) ?? null;
		},

		async findCandidateById(organizationId, installationId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
						eq(chatInstallation.provider, "slack"),
						eq(chatInstallation.status, "candidate"),
					),
				)
				.limit(1);
			return (row as SlackCandidateInstallationRecord | undefined) ?? null;
		},

		async findInstallationByRouteId(routeId) {
			const [row] = await db
				.select()
				.from(chatInstallation)
				.where(and(eq(chatInstallation.routeId, routeId), eq(chatInstallation.provider, "slack")))
				.limit(1);
			return (row as SlackCandidateInstallationRecord | undefined) ?? null;
		},

		async insertCandidate(input) {
			const [row] = await db
				.insert(chatInstallation)
				.values({
					organizationId: input.organizationId,
					provider: "slack",
					credentialSource: "organization_owned",
					status: "candidate",
					routeId: input.routeId,
					verificationState: "unverified",
					createdByUserId: input.createdByUserId,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to insert candidate Slack installation");
			}
			return row as SlackCandidateInstallationRecord;
		},

		async updateCandidate(organizationId, installationId, patch) {
			const [row] = await db
				.update(chatInstallation)
				.set({
					...patch,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
					),
				)
				.returning();
			if (!row) {
				throw new Error("Failed to update candidate Slack installation");
			}
			return row as SlackCandidateInstallationRecord;
		},

		async acquireClaim({ organizationId, claimKind, externalId, verifiedAt }) {
			const result = await acquireExternalOwnershipClaim(
				{
					organizationId,
					provider: "slack",
					claimKind,
					externalId,
					provenance: "verified_setup",
					verifiedAt,
				},
				{ db },
			);
			if (result.kind === "conflict") {
				return { kind: "conflict" };
			}
			return { kind: "acquired", claimId: result.claim.id };
		},

		async upsertCandidateConversation(input) {
			await upsertInstallationConversation(
				{
					organizationId: input.organizationId,
					installationId: input.installationId,
					userId: input.userId,
					externalUserId: input.externalUserId,
					externalConversationId: input.externalConversationId,
					conversationType: "private",
					reachabilityStatus: input.reachabilityStatus,
					verifiedAt: input.verifiedAt,
					lastUsedAt: input.verifiedAt,
				},
				{ db },
			);
		},

		async getRevisionNumber(organizationId, installationId, revisionId) {
			const [row] = await db
				.select({ revisionNumber: chatInstallationCredentialRevision.revisionNumber })
				.from(chatInstallationCredentialRevision)
				.where(
					and(
						eq(chatInstallationCredentialRevision.id, revisionId),
						eq(chatInstallationCredentialRevision.installationId, installationId),
						eq(chatInstallationCredentialRevision.organizationId, organizationId),
					),
				)
				.limit(1);
			return row?.revisionNumber ?? null;
		},
	};
}

export function resolveSlackSetupRepository(deps?: SlackSetupRuntimeDeps): SlackSetupRepository {
	return deps?.repository ?? createDrizzleSlackSetupRepository(deps?.db ?? defaultDb);
}

function slackFailureCode(failure: SlackCallFailure): string {
	switch (failure.kind) {
		case "platform":
			return failure.error;
		case "rate_limited":
			return "rate_limited";
		case "http":
			return `http_${failure.status}`;
		case "unknown":
			return failure.reason;
	}
}

async function defaultSendPrivateDm(
	botToken: string,
	input: { slackUserId: string; text: string },
): Promise<SendSlackPrivateDmResult> {
	const openOutcome = await openConversationWithOutcome(botToken, input.slackUserId);
	if (openOutcome.kind !== "ok") {
		return {
			kind: "failed",
			code: slackFailureCode(openOutcome),
			message: "Could not open a direct message conversation with the specified Slack user.",
		};
	}

	const postOutcome = await postMessageWithOutcome(botToken, {
		channel: openOutcome.result,
		text: input.text,
		blocks: [],
	});
	if (postOutcome.kind !== "ok") {
		return {
			kind: "failed",
			code: slackFailureCode(postOutcome),
			message: "Could not deliver the synthetic private test message to Slack.",
		};
	}

	return {
		kind: "ok",
		channelId: postOutcome.result.channel,
		messageTs: postOutcome.result.ts,
	};
}

export async function buildSlackCandidateSetupView(
	installation: SlackCandidateInstallationRecord,
	deps?: SlackSetupRuntimeDeps & { organizationName?: string | null },
): Promise<SlackCandidateSetupView> {
	const repository = resolveSlackSetupRepository(deps);
	const now = deps?.now ? deps.now() : new Date();
	const ttlMs = deps?.verificationTtlMs ?? SLACK_VERIFICATION_FRESHNESS_MS;

	const generated = generateSlackAppManifest({
		routeId: installation.routeId,
		appUrl: deps?.appUrl,
		organizationName: deps?.organizationName,
	});
	const computed = computeSlackCandidateSetupStatus(installation, now, ttlMs);
	const revisionNumber = installation.activeCredentialRevisionId
		? await repository.getRevisionNumber(
				installation.organizationId,
				installation.id,
				installation.activeCredentialRevisionId,
			)
		: null;

	return {
		installationId: installation.id,
		organizationId: installation.organizationId,
		routeId: installation.routeId,
		status: installation.status,
		verificationState: computed.effectiveVerificationState,
		readyForSwitch: computed.readyForSwitch,
		externalAppId: installation.externalAppId,
		externalBotId: installation.externalBotId,
		externalBotUsername: installation.externalBotUsername,
		externalSpaceId: installation.externalSpaceId,
		externalSpaceName: installation.externalSpaceName,
		hasStoredCredentials: Boolean(installation.activeCredentialRevisionId),
		credentialRevisionNumber: revisionNumber,
		urls: generated.urls,
		manifestJson: generated.json,
		manifestYaml: generated.yaml,
		steps: computed.steps,
		lastVerifiedAt: installation.lastVerifiedAt?.toISOString() ?? null,
		updatedAt: installation.updatedAt.toISOString(),
	};
}

/**
 * Loads the current candidate Slack setup view for an organization without creating a new row.
 */
export async function getSlackCandidateSetupView(
	organizationId: string,
	deps?: SlackSetupRuntimeDeps & { organizationName?: string | null },
): Promise<SlackCandidateSetupView | null> {
	const repository = resolveSlackSetupRepository(deps);
	const existing = await repository.findCandidateByOrg(organizationId);
	if (!existing) {
		return null;
	}
	return buildSlackCandidateSetupView(existing, deps);
}

/**
 * Prepares (or returns an existing) organization-owned Slack candidate installation
 * with a stable, non-secret `routeId` and generated Slack App Manifest.
 */
export async function prepareSlackCandidateInstallation(
	input: {
		organizationId: string;
		actorUserId: string;
		organizationName?: string | null;
	},
	deps?: SlackSetupRuntimeDeps,
): Promise<SlackCandidateSetupView> {
	const repository = resolveSlackSetupRepository(deps);
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;

	let candidate = await repository.findCandidateByOrg(input.organizationId);
	if (!candidate) {
		candidate = await repository.insertCandidate({
			organizationId: input.organizationId,
			routeId: generateRouteId(),
			createdByUserId: input.actorUserId,
		});

		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_CANDIDATE_PREPARED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "slack",
				routeId: candidate.routeId,
			},
		});
	}

	return buildSlackCandidateSetupView(candidate, {
		...deps,
		organizationName: input.organizationName,
	});
}

export type ConfigureSlackCredentialsResult =
	| { kind: "ok"; view: SlackCandidateSetupView }
	| {
			kind: "error";
			code:
				| "candidate_not_found"
				| "invalid_bot_token_format"
				| "invalid_signing_secret_format"
				| "invalid_bot_token"
				| "missing_slack_scope"
				| "identity_mismatch"
				| "workspace_claimed_by_other_org"
				| "app_claimed_by_other_org"
				| "slack_unavailable"
				| "secret_store_unavailable"
				| "credential_write_failed";
			message: string;
	  };

/**
 * Verifies Slack app & workspace identity via Slack bot metadata (`auth.test` + `bots.info`),
 * enforces cross-org ownership claims while allowing same-org workspace staging, and persists
 * an immutable organization-scoped credential revision. Never returns raw secrets.
 */
export async function configureSlackCandidateCredentials(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
		botToken: string;
		signingSecret: string;
	},
	deps?: SlackSetupRuntimeDeps,
): Promise<ConfigureSlackCredentialsResult> {
	const repository = resolveSlackSetupRepository(deps);
	const verifyMetadata = deps?.verifyBotMetadata ?? verifySlackBotMetadata;
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = deps?.now ? deps.now() : new Date();

	const botToken = input.botToken.trim();
	const signingSecret = input.signingSecret.trim();

	if (!botToken.startsWith(SLACK_BOT_TOKEN_PREFIX) || botToken.length < 12) {
		return {
			kind: "error",
			code: "invalid_bot_token_format",
			message: "Bot token must start with xoxb-.",
		};
	}

	if (signingSecret.length < 16 || /\s/.test(signingSecret)) {
		return {
			kind: "error",
			code: "invalid_signing_secret_format",
			message: "Signing secret must be at least 16 characters with no whitespace.",
		};
	}

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Slack installation was not found.",
		};
	}

	const metadataResult = await verifyMetadata(botToken);
	if (metadataResult.kind !== "ok") {
		const failureCode =
			metadataResult.kind === "invalid_token"
				? "invalid_bot_token"
				: metadataResult.kind === "missing_scope"
					? "missing_slack_scope"
					: metadataResult.kind === "identity_mismatch"
						? "identity_mismatch"
						: "slack_unavailable";

		const updatedEvidence: ChatVerificationEvidence = {
			...(candidate.verificationEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			lastFailureStep: "identity",
			lastFailureCode: failureCode,
			lastFailureAt: now.toISOString(),
		};

		await repository.updateCandidate(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: updatedEvidence,
		});

		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "slack",
				step: "identity",
				failureCode,
			},
		});

		const messages: Record<typeof failureCode, string> = {
			invalid_bot_token: "Slack rejected the bot token. Check your Bot User OAuth Token.",
			missing_slack_scope:
				"The Slack bot token is missing required scopes (including users:read for bot metadata verification).",
			identity_mismatch:
				"Slack returned inconsistent or incomplete app and bot metadata for this token.",
			slack_unavailable: "Slack API is temporarily unavailable. Please retry.",
		};

		return { kind: "error", code: failureCode, message: messages[failureCode] };
	}

	const { identity } = metadataResult;

	// Ownership claim 1: Slack workspace (same org may stage a second app in its own workspace)
	const workspaceClaim = await repository.acquireClaim({
		organizationId: input.organizationId,
		claimKind: "workspace",
		externalId: identity.teamId,
		verifiedAt: now,
	});
	if (workspaceClaim.kind === "conflict") {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "slack",
				step: "identity",
				failureCode: "workspace_claimed_by_other_org",
				externalSpaceId: identity.teamId,
			},
		});
		return {
			kind: "error",
			code: "workspace_claimed_by_other_org",
			message: "This Slack workspace is already connected to another Z8 organization.",
		};
	}

	// Ownership claim 2: workspace-scoped Slack app identity
	const appClaim = await repository.acquireClaim({
		organizationId: input.organizationId,
		claimKind: "bot",
		externalId: `${identity.teamId}:${identity.appId}`,
		verifiedAt: now,
	});
	if (appClaim.kind === "conflict") {
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "slack",
				step: "identity",
				failureCode: "app_claimed_by_other_org",
				externalAppId: identity.appId,
			},
		});
		return {
			kind: "error",
			code: "app_claimed_by_other_org",
			message: "This Slack app is already claimed by another Z8 organization.",
		};
	}

	// Store immutable credential revision without touching prior revisions or legacy secrets
	let revision: Awaited<ReturnType<typeof storeInstallationCredentialRevision>>;
	try {
		revision = await storeInstallationCredentialRevision(
			{
				organizationId: input.organizationId,
				installationId: candidate.id,
				provider: "slack",
				secrets: {
					bot_token: botToken,
					signing_secret: signingSecret,
				},
				status: "verified",
				externalIdentityFingerprint: `slack:${identity.teamId}:${identity.appId}:${identity.botId}:${identity.botUserId}`,
				verifiedAt: now,
				createdByUserId: input.actorUserId,
			},
			{
				db: deps?.db,
				repository: deps?.revisionRepository,
				storeSecret: deps?.storeSecret,
				deleteSecret: deps?.deleteSecret,
				secretStoreProvider: deps?.secretStoreProvider,
			},
		);
	} catch (error) {
		const isUnavailable = isSecretStoreUnavailableError(error);
		const failureCode = isUnavailable ? "secret_store_unavailable" : "credential_write_failed";
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "slack",
				step: "credentials",
				failureCode,
			},
		});
		return {
			kind: "error",
			code: failureCode,
			message: isUnavailable
				? "The organization secret store is currently unavailable. Existing Slack delivery is unchanged."
				: "Failed to store Slack credentials securely. Existing Slack delivery is unchanged.",
		};
	}

	// New revision invalidates prior signed-event and private-delivery proofs so fresh tests run against it
	const evidence: ChatVerificationEvidence = {
		source: "verified_setup",
		configuredAt: now.toISOString(),
		workspaceId: identity.teamId,
		workspaceName: identity.teamName || null,
		applicationId: identity.appId,
		botId: identity.botId,
		botUserId: identity.botUserId,
		botUsername: identity.botUsername,
		secretStoreStatus: "available",
		identityVerifiedAt: now.toISOString(),
		identityRevisionId: revision.id,
		signedEventVerifiedAt: null,
		signedEventRevisionId: null,
		signedEventType: null,
		signedEventExpiresAt: null,
		privateDeliveryVerifiedAt: null,
		privateDeliveryRevisionId: null,
		privateDeliveryTargetUserId: null,
		privateDeliveryChannelId: null,
		privateDeliveryExpiresAt: null,
		lastFailureStep: null,
		lastFailureCode: null,
		lastFailureAt: null,
	};

	const updated = await repository.updateCandidate(input.organizationId, candidate.id, {
		externalAppId: identity.appId,
		externalBotId: identity.botUserId,
		externalBotUsername: identity.botUsername,
		externalDisplayName: identity.teamName || identity.teamId,
		externalSpaceId: identity.teamId,
		externalSpaceName: identity.teamName || null,
		receiverScope: `slack-app:${identity.appId}:team:${identity.teamId}`,
		spaceClaimId: workspaceClaim.claimId,
		botClaimId: appClaim.claimId,
		activeCredentialRevisionId: revision.id,
		verificationState: "pending",
		verificationEvidence: evidence,
	});

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_CREDENTIALS_STORED,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: candidate.id,
		metadata: {
			provider: "slack",
			revisionId: revision.id,
			revisionNumber: revision.revisionNumber,
			secretStoreProvider: revision.secretStoreProvider,
			externalAppId: identity.appId,
			externalSpaceId: identity.teamId,
		},
	});

	const view = await buildSlackCandidateSetupView(updated, deps);
	return { kind: "ok", view };
}

export type SendSlackCandidateTestResult =
	| { kind: "ok"; view: SlackCandidateSetupView; channelId: string; messageTs: string }
	| {
			kind: "error";
			code:
				| "candidate_not_found"
				| "invalid_slack_user_id"
				| "credentials_not_configured"
				| "credentials_missing"
				| "secret_store_unavailable"
				| "private_delivery_failed";
			message: string;
	  };

/**
 * Sends a synthetic private DM test message to the admin's Slack user ID using the
 * candidate's immutable credential revision. Never sends production notifications or
 * approval cards, and stores the candidate DM separately from legacy Slack tables.
 */
export async function sendSlackCandidateTestMessage(
	input: {
		organizationId: string;
		actorUserId: string;
		installationId: string;
		slackUserId: string;
	},
	deps?: SlackSetupRuntimeDeps,
): Promise<SendSlackCandidateTestResult> {
	const repository = resolveSlackSetupRepository(deps);
	const sendPrivateDm = deps?.sendPrivateDm ?? defaultSendPrivateDm;
	const recordAudit = deps?.recordAudit ?? defaultRecordAudit;
	const now = deps?.now ? deps.now() : new Date();
	const ttlMs = deps?.verificationTtlMs ?? SLACK_VERIFICATION_FRESHNESS_MS;

	const slackUserId = input.slackUserId.trim().toUpperCase();
	if (!/^[UW][A-Z0-9]{7,}$/.test(slackUserId)) {
		return {
			kind: "error",
			code: "invalid_slack_user_id",
			message: "Enter a valid Slack member ID (for example, U01234567).",
		};
	}

	const candidate = await repository.findCandidateById(input.organizationId, input.installationId);
	if (!candidate) {
		return {
			kind: "error",
			code: "candidate_not_found",
			message: "Candidate Slack installation was not found.",
		};
	}

	if (!candidate.activeCredentialRevisionId) {
		return {
			kind: "error",
			code: "credentials_not_configured",
			message: "Save and verify the Slack bot token and signing secret before testing delivery.",
		};
	}

	const credResult = await readInstallationCredentialRevision(
		{
			organizationId: input.organizationId,
			installationId: candidate.id,
			revisionId: candidate.activeCredentialRevisionId,
		},
		{
			db: deps?.db,
			repository: deps?.revisionRepository,
			readSecret: deps?.readSecret,
		},
	);

	if (credResult.kind === "unavailable") {
		return {
			kind: "error",
			code: "secret_store_unavailable",
			message: "The organization secret store is temporarily unavailable. Retry shortly.",
		};
	}

	if (credResult.kind !== "ok" || !credResult.secrets.bot_token) {
		return {
			kind: "error",
			code: "credentials_missing",
			message: "Stored Slack credentials are missing. Re-enter and verify your bot credentials.",
		};
	}

	const testText =
		"Z8 Slack app verification test — this synthetic private message confirms your organization-owned Slack app can reach your workspace. Live notifications and approvals remain unchanged until you switch.";

	const deliveryResult = await sendPrivateDm(credResult.secrets.bot_token, {
		slackUserId,
		text: testText,
	});

	if (deliveryResult.kind !== "ok") {
		const failedEvidence: ChatVerificationEvidence = {
			...(candidate.verificationEvidence ?? { source: "verified_setup" }),
			source: "verified_setup",
			lastFailureStep: "private_test",
			lastFailureCode: deliveryResult.code,
			lastFailureAt: now.toISOString(),
		};
		await repository.updateCandidate(input.organizationId, candidate.id, {
			verificationState: "failed",
			verificationEvidence: failedEvidence,
		});
		await recordAudit({
			action: AuditAction.CHAT_INSTALLATION_VERIFICATION_FAILED,
			actorId: input.actorUserId,
			organizationId: input.organizationId,
			targetId: candidate.id,
			metadata: {
				provider: "slack",
				step: "private_test",
				failureCode: deliveryResult.code,
			},
		});
		return {
			kind: "error",
			code: "private_delivery_failed",
			message: deliveryResult.message,
		};
	}

	// Store segregated candidate DM conversation (never mutates legacy slack_conversation / slack_user_mapping)
	await repository.upsertCandidateConversation({
		organizationId: input.organizationId,
		installationId: candidate.id,
		userId: input.actorUserId,
		externalUserId: slackUserId,
		externalConversationId: deliveryResult.channelId,
		reachabilityStatus: "reachable",
		verifiedAt: now,
	});

	const nextEvidence: ChatVerificationEvidence = {
		...(candidate.verificationEvidence ?? { source: "verified_setup" }),
		source: "verified_setup",
		privateDeliveryVerifiedAt: now.toISOString(),
		privateDeliveryRevisionId: candidate.activeCredentialRevisionId,
		privateDeliveryTargetUserId: slackUserId,
		privateDeliveryChannelId: deliveryResult.channelId,
		privateDeliveryExpiresAt: computeExpiryIso(now, ttlMs),
		...(candidate.verificationEvidence?.lastFailureStep === "private_test"
			? { lastFailureStep: null, lastFailureCode: null, lastFailureAt: null }
			: {}),
	};

	const nextStatus = computeSlackCandidateSetupStatus(
		{
			...candidate,
			verificationEvidence: nextEvidence,
		},
		now,
		ttlMs,
	);

	const updated = await repository.updateCandidate(input.organizationId, candidate.id, {
		verificationEvidence: nextEvidence,
		verificationState: nextStatus.effectiveVerificationState,
		lastVerifiedAt: nextStatus.readyForSwitch ? now : candidate.lastVerifiedAt,
	});

	await recordAudit({
		action: AuditAction.CHAT_INSTALLATION_TEST_MESSAGE_SENT,
		actorId: input.actorUserId,
		organizationId: input.organizationId,
		targetId: candidate.id,
		metadata: {
			provider: "slack",
			revisionId: candidate.activeCredentialRevisionId,
			targetSlackUserId: slackUserId,
			readyForSwitch: nextStatus.readyForSwitch,
		},
	});

	const view = await buildSlackCandidateSetupView(updated, deps);
	return {
		kind: "ok",
		view,
		channelId: deliveryResult.channelId,
		messageTs: deliveryResult.messageTs,
	};
}
