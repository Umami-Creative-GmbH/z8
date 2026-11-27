import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	CHAT_INSTALLATION_PROVIDERS,
	type ChatInstallationProvider,
	type ChatNotificationDispatchFailureClassification,
	type ChatNotificationDispatchRedactedDiagnostics,
	type ChatNotificationDispatchSourceKind,
	type ChatNotificationDispatchStatus,
	chatInstallation,
	chatInstallationCredentialRevision,
	chatNotificationDispatchAttempt,
} from "@/db/schema";
import { dateFromInstant, instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ChatNotificationDurableDispatch");

/**
 * Unresolved uncertain durable chat notification dispatches close explicitly as
 * `closed_unknown` after 7 days (168 hours) per ADR 0003 & ticket #2044.
 */
export const DURABLE_DISPATCH_UNKNOWN_CLOSURE_HOURS = 7 * 24;

/**
 * Default threshold (5 minutes, matching outbox lease duration) after which an
 * uncompleted `intent_recorded` attempt is surfaced alongside `reconciliation_required`
 * items in the operational reconciliation list.
 */
export const DURABLE_DISPATCH_STALE_INTENT_MINUTES = 5;

export type DurableDispatchAttemptRow = typeof chatNotificationDispatchAttempt.$inferSelect;

export type DurableDispatchDb = Pick<
	typeof defaultDb,
	"select" | "insert" | "update" | "execute" | "transaction"
>;

export interface DurableDispatchRuntimeDeps {
	db?: DurableDispatchDb;
	now?: () => Date;
}

const CONFIRMED_UNSENT_MARKER = Symbol.for("z8.chatInstallations.confirmedUnsentError");
const UNCERTAIN_DISPATCH_MARKER = Symbol.for("z8.chatInstallations.uncertainDispatchError");

export class DurableDispatchConfirmedUnsentError extends Error {
	readonly [CONFIRMED_UNSENT_MARKER] = true;
	readonly diagnostics: ChatNotificationDispatchRedactedDiagnostics;
	readonly causeError?: unknown;

	constructor(
		message: string,
		diagnostics: ChatNotificationDispatchRedactedDiagnostics = {},
		causeError?: unknown,
	) {
		super(message);
		this.name = "DurableDispatchConfirmedUnsentError";
		this.diagnostics = sanitizeRedactedDiagnostics(diagnostics);
		this.causeError = causeError;
	}
}

export class DurableDispatchUncertainError extends Error {
	readonly [UNCERTAIN_DISPATCH_MARKER] = true;
	readonly classification: Exclude<
		ChatNotificationDispatchFailureClassification,
		"confirmed_unsent"
	>;
	readonly diagnostics: ChatNotificationDispatchRedactedDiagnostics;
	readonly causeError?: unknown;

	constructor(
		message: string,
		diagnostics: ChatNotificationDispatchRedactedDiagnostics = {},
		options?: {
			classification?: Exclude<ChatNotificationDispatchFailureClassification, "confirmed_unsent">;
			causeError?: unknown;
		},
	) {
		super(message);
		this.name = "DurableDispatchUncertainError";
		this.classification = options?.classification ?? "ambiguous";
		this.diagnostics = sanitizeRedactedDiagnostics(diagnostics);
		this.causeError = options?.causeError;
	}
}

export function isConfirmedUnsentError(
	error: unknown,
): error is DurableDispatchConfirmedUnsentError {
	return (
		error instanceof DurableDispatchConfirmedUnsentError ||
		(typeof error === "object" && error !== null && CONFIRMED_UNSENT_MARKER in error)
	);
}

export function isUncertainDispatchError(error: unknown): error is DurableDispatchUncertainError {
	return (
		error instanceof DurableDispatchUncertainError ||
		(typeof error === "object" && error !== null && UNCERTAIN_DISPATCH_MARKER in error)
	);
}

export function isChatInstallationProvider(value: string): value is ChatInstallationProvider {
	return (CHAT_INSTALLATION_PROVIDERS as readonly string[]).includes(value);
}

const MAX_DIAGNOSTIC_TEXT_LENGTH = 160;

// Patterns for secrets, tokens, URLs, and credentials that must never be persisted or logged.
const SECRET_PATTERNS: readonly RegExp[] = [
	/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
	/Basic\s+[A-Za-z0-9+/]+=*/gi,
	/\bxox[a-zA-Z]-[A-Za-z0-9-]+/g,
	/\bxapp-[A-Za-z0-9-]+/g,
	/\b\d{6,15}:[A-Za-z0-9_-]{10,}\b/g,
	/\b[MN][A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}\b/g,
	/https?:\/\/[^\s"'<>]+/gi,
	/\b[a-f0-9]{32,}\b/gi,
];

function sanitizeDiagnosticString(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== "string") return undefined;

	let cleaned = value.replace(/[\r\n\t]+/g, " ").trim();
	for (const pattern of SECRET_PATTERNS) {
		cleaned = cleaned.replace(pattern, "[redacted]");
	}
	if (cleaned.length > MAX_DIAGNOSTIC_TEXT_LENGTH) {
		cleaned = `${cleaned.slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH - 3)}...`;
	}
	return cleaned;
}

function sanitizeHttpStatus(value: unknown): number | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) {
		return value;
	}
	return undefined;
}

/**
 * Strictly allowlists and scrubs diagnostic fields so raw bot tokens, signing secrets,
 * authorization headers, webhook URLs, and message bodies can never be persisted or logged.
 */
export function sanitizeRedactedDiagnostics(
	input: Record<string, unknown> | ChatNotificationDispatchRedactedDiagnostics | null | undefined,
): ChatNotificationDispatchRedactedDiagnostics {
	if (!input || typeof input !== "object") return {};

	const source = input as Record<string, unknown>;
	const result: ChatNotificationDispatchRedactedDiagnostics = {};

	const stringFields = [
		"reason",
		"errorCode",
		"errorName",
		"switchedFromInstallationId",
		"activeInstallationIdAtCheck",
		"installationStatusAtIntent",
		"receiverScope",
		"legacyRecordId",
		"closedReason",
	] as const;

	for (const field of stringFields) {
		if (field in source) {
			const sanitized = sanitizeDiagnosticString(source[field]);
			if (sanitized !== undefined) {
				result[field] = sanitized;
			}
		}
	}

	if ("httpStatus" in source) {
		const status = sanitizeHttpStatus(source.httpStatus);
		if (status !== undefined) {
			result.httpStatus = status;
		}
	}

	return result;
}

export function extractRedactedErrorDiagnostics(
	error: unknown,
	fallbackReason: string,
): ChatNotificationDispatchRedactedDiagnostics {
	if (isConfirmedUnsentError(error) || isUncertainDispatchError(error)) {
		return sanitizeRedactedDiagnostics({
			reason: fallbackReason,
			...error.diagnostics,
			errorName: error.diagnostics.errorName ?? error.name,
		});
	}

	const errObj =
		typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
	const errorName =
		error instanceof Error ? error.name : typeof errObj?.name === "string" ? errObj.name : null;
	const errorCode =
		typeof errObj?.code === "string" || typeof errObj?.code === "number"
			? String(errObj.code)
			: null;
	const rawStatus = errObj?.status ?? errObj?.statusCode;
	const httpStatus = typeof rawStatus === "number" ? rawStatus : null;

	// Never copy arbitrary `error.message` directly because third-party SDK errors can embed
	// tokens, URLs, or message bodies. Only record bounded errorName/errorCode/httpStatus.
	return sanitizeRedactedDiagnostics({
		reason: fallbackReason,
		errorName,
		errorCode,
		httpStatus,
	});
}

export type PriorDurableDispatchStateDecision =
	| {
			action: "create_attempt";
			nextAttemptNumber: number;
			reroutedFromAttemptId?: string;
			switchedFromInstallationId?: string | null;
	  }
	| {
			action: "quarantine_uncertain";
			installationSwitched: boolean;
	  }
	| { action: "already_sent" }
	| { action: "already_reconciliation_required"; installationSwitched: boolean }
	| { action: "already_closed_unknown" };

/**
 * Pure state-machine decision for an incoming durable dispatch attempt given the latest
 * prior attempt for `(organizationId, dedupeKey)` and the current active installation ID.
 */
export function evaluatePriorDurableDispatchState(input: {
	priorAttempt: {
		id: string;
		status: ChatNotificationDispatchStatus;
		attemptNumber: number;
		installationId: string | null;
	} | null;
	currentActiveInstallationId: string | null;
}): PriorDurableDispatchStateDecision {
	const { priorAttempt, currentActiveInstallationId } = input;
	if (!priorAttempt) {
		return { action: "create_attempt", nextAttemptNumber: 1 };
	}

	const installationSwitched =
		priorAttempt.installationId !== null &&
		currentActiveInstallationId !== null &&
		priorAttempt.installationId !== currentActiveInstallationId;

	switch (priorAttempt.status) {
		case "confirmed_unsent":
			return {
				action: "create_attempt",
				nextAttemptNumber: priorAttempt.attemptNumber + 1,
				reroutedFromAttemptId: priorAttempt.id,
				...(priorAttempt.installationId !== currentActiveInstallationId
					? { switchedFromInstallationId: priorAttempt.installationId }
					: {}),
			};
		case "intent_recorded":
			return {
				action: "quarantine_uncertain",
				installationSwitched,
			};
		case "sent":
			return { action: "already_sent" };
		case "reconciliation_required":
			return {
				action: "already_reconciliation_required",
				installationSwitched,
			};
		case "closed_unknown":
			return { action: "already_closed_unknown" };
	}
}

/**
 * Computes the exact 7-day (168h) UTC cutoff timestamp for closing unresolved uncertain
 * durable dispatch attempts with an explicit `closed_unknown` outcome.
 */
export function computeDurableDispatchExpiryCutoff(now: Date): Date {
	const cutoffInstant = instantFromDate(now).subtract({
		hours: DURABLE_DISPATCH_UNKNOWN_CLOSURE_HOURS,
	});
	return dateFromInstant(cutoffInstant);
}

interface ResolvedInstallationTarget {
	installationId: string | null;
	credentialRevisionId: string | null;
	installationStatus: string | null;
	receiverScope: string | null;
	legacyRecordId: string | null;
}

async function resolveCurrentInstallationTarget(
	db: Pick<DurableDispatchDb, "select">,
	organizationId: string,
	provider: ChatInstallationProvider,
	explicit?: { installationId?: string | null; credentialRevisionId?: string | null },
): Promise<ResolvedInstallationTarget> {
	if (explicit?.installationId) {
		const [inst] = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.id, explicit.installationId),
					eq(chatInstallation.organizationId, organizationId),
					eq(chatInstallation.provider, provider),
				),
			)
			.limit(1);
		if (!inst) {
			throw new DurableDispatchConfirmedUnsentError("Explicit chat installation not found", {
				reason: "explicit_installation_not_found",
			});
		}

		let credentialRevisionId = explicit.credentialRevisionId ?? inst.activeCredentialRevisionId;
		if (credentialRevisionId) {
			const [rev] = await db
				.select({ id: chatInstallationCredentialRevision.id })
				.from(chatInstallationCredentialRevision)
				.where(
					and(
						eq(chatInstallationCredentialRevision.id, credentialRevisionId),
						eq(chatInstallationCredentialRevision.installationId, inst.id),
						eq(chatInstallationCredentialRevision.organizationId, organizationId),
					),
				)
				.limit(1);
			if (!rev) {
				throw new DurableDispatchConfirmedUnsentError(
					"Explicit chat credential revision does not match installation",
					{ reason: "credential_revision_mismatch" },
				);
			}
			credentialRevisionId = rev.id;
		}

		return {
			installationId: inst.id,
			credentialRevisionId: credentialRevisionId ?? null,
			installationStatus: inst.status,
			receiverScope: inst.receiverScope,
			legacyRecordId: inst.legacyRecordId,
		};
	}

	const rows = await db
		.select()
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, organizationId),
				eq(chatInstallation.provider, provider),
				inArray(chatInstallation.status, ["active", "legacy_active"]),
			),
		)
		.orderBy(asc(chatInstallation.createdAt), asc(chatInstallation.id));

	const selected =
		rows.find((row) => row.status === "active") ??
		rows.find((row) => row.status === "legacy_active") ??
		null;

	if (!selected) {
		return {
			installationId: null,
			credentialRevisionId: null,
			installationStatus: null,
			receiverScope: null,
			legacyRecordId: null,
		};
	}

	return {
		installationId: selected.id,
		credentialRevisionId: selected.activeCredentialRevisionId ?? null,
		installationStatus: selected.status,
		receiverScope: selected.receiverScope,
		legacyRecordId: selected.legacyRecordId,
	};
}

function getNow(deps?: DurableDispatchRuntimeDeps): Date {
	return deps?.now ? deps.now() : dateFromInstant(systemClock.nowInstant());
}

async function runInDispatchTransaction<T>(
	db: DurableDispatchDb,
	lockKey: string,
	work: (tx: Pick<DurableDispatchDb, "select" | "insert" | "update" | "execute">) => Promise<T>,
): Promise<T> {
	if (typeof db.transaction === "function") {
		return db.transaction(async (tx) => {
			if (typeof tx.execute === "function") {
				await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
			}
			return work(tx);
		});
	}
	return work(db);
}

export interface RecordDurableDispatchIntentInput {
	organizationId: string;
	provider: ChatInstallationProvider;
	sourceKind: ChatNotificationDispatchSourceKind;
	sourceRefId: string;
	dedupeKey: string;
	installationId?: string | null;
	credentialRevisionId?: string | null;
	diagnostics?: ChatNotificationDispatchRedactedDiagnostics;
}

export type RecordDurableDispatchIntentResult =
	| {
			kind: "proceed";
			attempt: DurableDispatchAttemptRow;
			reroutedFromAttemptId: string | null;
	  }
	| {
			kind: "already_sent";
			attempt: DurableDispatchAttemptRow;
	  }
	| {
			kind: "reconciliation_required";
			attempt: DurableDispatchAttemptRow;
			installationSwitched: boolean;
	  }
	| {
			kind: "closed_unknown";
			attempt: DurableDispatchAttemptRow;
	  };

/**
 * Resolves the active installation & credential revision for `(organizationId, provider)`
 * and commits an `intent_recorded` attempt row BEFORE any external provider API call.
 *
 * - If a prior attempt for `(organizationId, dedupeKey)` is `intent_recorded`, it is
 *   quarantined to `reconciliation_required` (keeping its original installation and
 *   credential revision intact) and NEVER automatically resent or rerouted.
 * - Only attempts explicitly marked `confirmed_unsent` allow creating a new attempt
 *   bound to the current active installation under the existing `dedupeKey`.
 */
export async function recordDurableDispatchIntent(
	input: RecordDurableDispatchIntentInput,
	deps?: DurableDispatchRuntimeDeps,
): Promise<RecordDurableDispatchIntentResult> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const lockKey = `chat-dispatch:${input.organizationId}:${input.dedupeKey}`;

	const outcome = await runInDispatchTransaction(db, lockKey, async (tx) => {
		const [latestAttempt] = await tx
			.select()
			.from(chatNotificationDispatchAttempt)
			.where(
				and(
					eq(chatNotificationDispatchAttempt.organizationId, input.organizationId),
					eq(chatNotificationDispatchAttempt.dedupeKey, input.dedupeKey),
				),
			)
			.orderBy(desc(chatNotificationDispatchAttempt.attemptNumber))
			.limit(1);

		// react-doctor-disable-next-line react-doctor/server-sequential-independent-await -- Both lookups use the same locked dispatch transaction.
		const target = await resolveCurrentInstallationTarget(
			tx,
			input.organizationId,
			input.provider,
			{
				installationId: input.installationId,
				credentialRevisionId: input.credentialRevisionId,
			},
		);

		const decision = evaluatePriorDurableDispatchState({
			priorAttempt: latestAttempt
				? {
						id: latestAttempt.id,
						status: latestAttempt.status,
						attemptNumber: latestAttempt.attemptNumber,
						installationId: latestAttempt.installationId,
					}
				: null,
			currentActiveInstallationId: target.installationId,
		});

		if (decision.action === "already_sent" && latestAttempt) {
			return {
				result: { kind: "already_sent" as const, attempt: latestAttempt },
				logQuarantine: null,
			};
		}

		if (decision.action === "already_closed_unknown" && latestAttempt) {
			return {
				result: { kind: "closed_unknown" as const, attempt: latestAttempt },
				logQuarantine: null,
			};
		}

		if (decision.action === "already_reconciliation_required" && latestAttempt) {
			return {
				result: {
					kind: "reconciliation_required" as const,
					attempt: latestAttempt,
					installationSwitched: decision.installationSwitched,
				},
				logQuarantine: null,
			};
		}

		if (decision.action === "quarantine_uncertain" && latestAttempt) {
			const mergedDiagnostics = sanitizeRedactedDiagnostics({
				...latestAttempt.redactedDiagnostics,
				...input.diagnostics,
				reason: decision.installationSwitched
					? "worker_lost_across_switch"
					: "worker_lost_uncertain_outcome",
				switchedFromInstallationId: latestAttempt.installationId,
				activeInstallationIdAtCheck: target.installationId,
			});

			const [updated] = await tx
				.update(chatNotificationDispatchAttempt)
				.set({
					status: "reconciliation_required",
					reconciliationRequiredAt: latestAttempt.reconciliationRequiredAt ?? now,
					failureClassification: latestAttempt.failureClassification ?? "worker_lost",
					redactedDiagnostics: mergedDiagnostics,
					updatedAt: now,
				})
				.where(
					and(
						eq(chatNotificationDispatchAttempt.id, latestAttempt.id),
						eq(chatNotificationDispatchAttempt.organizationId, input.organizationId),
					),
				)
				.returning();

			const quarantined = updated ?? latestAttempt;
			return {
				result: {
					kind: "reconciliation_required" as const,
					attempt: quarantined,
					installationSwitched: decision.installationSwitched,
				},
				logQuarantine: {
					attemptId: quarantined.id,
					organizationId: quarantined.organizationId,
					provider: quarantined.provider,
					sourceKind: quarantined.sourceKind,
					sourceRefId: quarantined.sourceRefId,
					dedupeKey: quarantined.dedupeKey,
					installationId: quarantined.installationId,
					credentialRevisionId: quarantined.credentialRevisionId,
					activeInstallationId: target.installationId,
					installationSwitched: decision.installationSwitched,
					failureClassification: quarantined.failureClassification,
					diagnostics: mergedDiagnostics,
				},
			};
		}

		const nextAttemptNumber = decision.action === "create_attempt" ? decision.nextAttemptNumber : 1;
		const reroutedFromAttemptId =
			decision.action === "create_attempt" ? (decision.reroutedFromAttemptId ?? null) : null;

		const initialDiagnostics = sanitizeRedactedDiagnostics({
			...input.diagnostics,
			installationStatusAtIntent: target.installationStatus,
			receiverScope: target.receiverScope,
			legacyRecordId: target.legacyRecordId,
			...(decision.action === "create_attempt" && "switchedFromInstallationId" in decision
				? { switchedFromInstallationId: decision.switchedFromInstallationId }
				: {}),
		});

		const [created] = await tx
			.insert(chatNotificationDispatchAttempt)
			.values({
				organizationId: input.organizationId,
				provider: input.provider,
				sourceKind: input.sourceKind,
				sourceRefId: input.sourceRefId,
				dedupeKey: input.dedupeKey,
				installationId: target.installationId,
				credentialRevisionId: target.credentialRevisionId,
				status: "intent_recorded",
				attemptNumber: nextAttemptNumber,
				intentRecordedAt: now,
				redactedDiagnostics: Object.keys(initialDiagnostics).length > 0 ? initialDiagnostics : null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		return {
			result: {
				kind: "proceed" as const,
				attempt: created,
				reroutedFromAttemptId,
			},
			logQuarantine: null,
		};
	});

	if (outcome.logQuarantine) {
		logger.error(
			outcome.logQuarantine,
			"Durable chat notification dispatch outcome uncertain; quarantined for reconciliation without automatic resend",
		);
	}

	return outcome.result;
}

/**
 * Records the timestamp at which the worker invokes the external provider API.
 */
export async function markDurableDispatchProviderCalled(
	input: {
		organizationId: string;
		attemptId: string;
	},
	deps?: DurableDispatchRuntimeDeps,
): Promise<DurableDispatchAttemptRow | null> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);

	const [updated] = await db
		.update(chatNotificationDispatchAttempt)
		.set({
			providerCalledAt: sql`COALESCE(${chatNotificationDispatchAttempt.providerCalledAt}, ${now})`,
			updatedAt: now,
		})
		.where(
			and(
				eq(chatNotificationDispatchAttempt.id, input.attemptId),
				eq(chatNotificationDispatchAttempt.organizationId, input.organizationId),
				eq(chatNotificationDispatchAttempt.status, "intent_recorded"),
			),
		)
		.returning();

	return updated ?? null;
}

/**
 * Marks a durable dispatch attempt as `sent` after positive provider confirmation.
 * Also allows a slow worker that received a real provider acknowledgement to resolve
 * an attempt that had been quarantined to `reconciliation_required`.
 */
export async function markDurableDispatchSent(
	input: {
		organizationId: string;
		attemptId: string;
		diagnostics?: ChatNotificationDispatchRedactedDiagnostics;
	},
	deps?: DurableDispatchRuntimeDeps,
): Promise<DurableDispatchAttemptRow | null> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const sanitized = input.diagnostics ? sanitizeRedactedDiagnostics(input.diagnostics) : null;

	const [existing] = await db
		.select()
		.from(chatNotificationDispatchAttempt)
		.where(
			and(
				eq(chatNotificationDispatchAttempt.id, input.attemptId),
				eq(chatNotificationDispatchAttempt.organizationId, input.organizationId),
			),
		)
		.limit(1);

	if (!existing) return null;
	if (existing.status !== "intent_recorded" && existing.status !== "reconciliation_required") {
		return existing;
	}

	const mergedDiagnostics = sanitizeRedactedDiagnostics({
		...existing.redactedDiagnostics,
		...sanitized,
	});

	const [updated] = await db
		.update(chatNotificationDispatchAttempt)
		.set({
			status: "sent",
			providerCalledAt: existing.providerCalledAt ?? now,
			completedAt: now,
			failureClassification: null,
			redactedDiagnostics:
				Object.keys(mergedDiagnostics).length > 0
					? mergedDiagnostics
					: existing.redactedDiagnostics,
			updatedAt: now,
		})
		.where(
			and(
				eq(chatNotificationDispatchAttempt.id, input.attemptId),
				eq(chatNotificationDispatchAttempt.organizationId, input.organizationId),
				inArray(chatNotificationDispatchAttempt.status, [
					"intent_recorded",
					"reconciliation_required",
				]),
			),
		)
		.returning();

	return updated ?? existing;
}

/**
 * Marks an `intent_recorded` attempt as explicitly `confirmed_unsent` (failed BEFORE
 * provider acceptance). This releases the active-attempt uniqueness guard so a retry
 * can safely reroute to the currently active installation under the existing `dedupeKey`.
 */
export async function markDurableDispatchConfirmedUnsent(
	input: {
		organizationId: string;
		attemptId: string;
		diagnostics?: ChatNotificationDispatchRedactedDiagnostics;
	},
	deps?: DurableDispatchRuntimeDeps,
): Promise<DurableDispatchAttemptRow | null> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);

	const [existing] = await db
		.select()
		.from(chatNotificationDispatchAttempt)
		.where(
			and(
				eq(chatNotificationDispatchAttempt.id, input.attemptId),
				eq(chatNotificationDispatchAttempt.organizationId, input.organizationId),
			),
		)
		.limit(1);

	if (!existing || existing.status !== "intent_recorded") {
		return existing ?? null;
	}

	const mergedDiagnostics = sanitizeRedactedDiagnostics({
		...existing.redactedDiagnostics,
		...input.diagnostics,
	});

	const [updated] = await db
		.update(chatNotificationDispatchAttempt)
		.set({
			status: "confirmed_unsent",
			completedAt: now,
			failureClassification: "confirmed_unsent",
			redactedDiagnostics:
				Object.keys(mergedDiagnostics).length > 0
					? mergedDiagnostics
					: existing.redactedDiagnostics,
			updatedAt: now,
		})
		.where(
			and(
				eq(chatNotificationDispatchAttempt.id, input.attemptId),
				eq(chatNotificationDispatchAttempt.organizationId, input.organizationId),
				eq(chatNotificationDispatchAttempt.status, "intent_recorded"),
			),
		)
		.returning();

	return updated ?? existing;
}

/**
 * Marks an `intent_recorded` attempt as `reconciliation_required` when provider outcome
 * is uncertain (e.g., timeout, network disconnect, unacknowledged response, or worker crash).
 *
 * Keeps the attempt bound to its ORIGINAL installation and credential revision, emits
 * redacted operational logs, and keeps the dedupe key out of automatic resend.
 */
export async function markDurableDispatchUncertain(
	input: {
		organizationId: string;
		attemptId: string;
		classification?: Exclude<ChatNotificationDispatchFailureClassification, "confirmed_unsent">;
		diagnostics?: ChatNotificationDispatchRedactedDiagnostics;
	},
	deps?: DurableDispatchRuntimeDeps,
): Promise<DurableDispatchAttemptRow | null> {
	const db = deps?.db ?? defaultDb;
	const now = getNow(deps);
	const classification = input.classification ?? "ambiguous";

	const [existing] = await db
		.select()
		.from(chatNotificationDispatchAttempt)
		.where(
			and(
				eq(chatNotificationDispatchAttempt.id, input.attemptId),
				eq(chatNotificationDispatchAttempt.organizationId, input.organizationId),
			),
		)
		.limit(1);

	if (!existing) return null;
	if (existing.status === "sent" || existing.status === "closed_unknown") {
		return existing;
	}

	const currentTarget = await resolveCurrentInstallationTarget(
		db,
		existing.organizationId,
		existing.provider,
	);
	const installationSwitched =
		existing.installationId !== null &&
		currentTarget.installationId !== null &&
		existing.installationId !== currentTarget.installationId;

	const mergedDiagnostics = sanitizeRedactedDiagnostics({
		...existing.redactedDiagnostics,
		...input.diagnostics,
		switchedFromInstallationId: existing.installationId,
		activeInstallationIdAtCheck: currentTarget.installationId,
	});

	const [updated] = await db
		.update(chatNotificationDispatchAttempt)
		.set({
			status: "reconciliation_required",
			providerCalledAt: existing.providerCalledAt ?? now,
			reconciliationRequiredAt: existing.reconciliationRequiredAt ?? now,
			failureClassification: classification,
			redactedDiagnostics:
				Object.keys(mergedDiagnostics).length > 0
					? mergedDiagnostics
					: existing.redactedDiagnostics,
			updatedAt: now,
		})
		.where(
			and(
				eq(chatNotificationDispatchAttempt.id, input.attemptId),
				eq(chatNotificationDispatchAttempt.organizationId, input.organizationId),
				inArray(chatNotificationDispatchAttempt.status, [
					"intent_recorded",
					"reconciliation_required",
				]),
			),
		)
		.returning();

	const finalRow = updated ?? existing;

	logger.error(
		{
			attemptId: finalRow.id,
			organizationId: finalRow.organizationId,
			provider: finalRow.provider,
			sourceKind: finalRow.sourceKind,
			sourceRefId: finalRow.sourceRefId,
			dedupeKey: finalRow.dedupeKey,
			installationId: finalRow.installationId,
			credentialRevisionId: finalRow.credentialRevisionId,
			activeInstallationId: currentTarget.installationId,
			installationSwitched,
			failureClassification: finalRow.failureClassification,
			diagnostics: mergedDiagnostics,
		},
		"Durable chat notification dispatch marked uncertain and quarantined for operations reconciliation",
	);

	return finalRow;
}

export interface DurableDispatchReconciliationItem {
	attemptId: string;
	organizationId: string;
	provider: ChatInstallationProvider;
	sourceKind: ChatNotificationDispatchSourceKind;
	sourceRefId: string;
	dedupeKey: string;
	installationId: string | null;
	credentialRevisionId: string | null;
	status: "reconciliation_required" | "intent_recorded";
	attemptNumber: number;
	failureClassification: ChatNotificationDispatchFailureClassification | null;
	intentRecordedAt: string;
	providerCalledAt: string | null;
	reconciliationRequiredAt: string | null;
	redactedDiagnostics: ChatNotificationDispatchRedactedDiagnostics;
}

/**
 * Returns the redacted operational view of durable chat notification dispatch attempts
 * requiring reconciliation (all `reconciliation_required` rows, plus stale `intent_recorded`
 * rows whose worker appears to have died before recording an outcome).
 */
export async function listDurableDispatchesNeedingReconciliation(
	organizationId?: string,
	options?: DurableDispatchRuntimeDeps & {
		provider?: ChatInstallationProvider;
		limit?: number;
		staleIntentMinutes?: number;
	},
): Promise<DurableDispatchReconciliationItem[]> {
	const db = options?.db ?? defaultDb;
	const now = getNow(options);
	const limit = options?.limit ?? 100;
	const staleIntentMinutes = options?.staleIntentMinutes ?? DURABLE_DISPATCH_STALE_INTENT_MINUTES;
	const staleIntentCutoff = dateFromInstant(
		instantFromDate(now).subtract({ minutes: staleIntentMinutes }),
	);

	const statusCondition = or(
		eq(chatNotificationDispatchAttempt.status, "reconciliation_required"),
		and(
			eq(chatNotificationDispatchAttempt.status, "intent_recorded"),
			lte(chatNotificationDispatchAttempt.intentRecordedAt, staleIntentCutoff),
		),
	);

	const conditions = [statusCondition];
	if (organizationId) {
		conditions.push(eq(chatNotificationDispatchAttempt.organizationId, organizationId));
	}
	if (options?.provider) {
		conditions.push(eq(chatNotificationDispatchAttempt.provider, options.provider));
	}

	const rows = await db
		.select()
		.from(chatNotificationDispatchAttempt)
		.where(and(...conditions))
		.orderBy(
			asc(chatNotificationDispatchAttempt.reconciliationRequiredAt),
			asc(chatNotificationDispatchAttempt.intentRecordedAt),
			asc(chatNotificationDispatchAttempt.id),
		)
		.limit(limit);

	return rows.map((row) => ({
		attemptId: row.id,
		organizationId: row.organizationId,
		provider: row.provider,
		sourceKind: row.sourceKind,
		sourceRefId: row.sourceRefId,
		dedupeKey: row.dedupeKey,
		installationId: row.installationId,
		credentialRevisionId: row.credentialRevisionId,
		status: row.status === "intent_recorded" ? "intent_recorded" : "reconciliation_required",
		attemptNumber: row.attemptNumber,
		failureClassification: row.failureClassification,
		intentRecordedAt: row.intentRecordedAt.toISOString(),
		providerCalledAt: row.providerCalledAt?.toISOString() ?? null,
		reconciliationRequiredAt: row.reconciliationRequiredAt?.toISOString() ?? null,
		redactedDiagnostics: sanitizeRedactedDiagnostics(row.redactedDiagnostics),
	}));
}

export interface CloseExpiredUncertainDurableDispatchesResult {
	closedCount: number;
	closedAttemptIds: string[];
	cutoffAt: string;
}

/**
 * Closes unresolved `reconciliation_required` and stale `intent_recorded` attempts older
 * than 7 days (168h) with an explicit `closed_unknown` status and `unknown_closed_at`
 * timestamp per ADR 0003.
 */
export async function closeExpiredUncertainDurableDispatches(
	nowInput?: Date,
	deps?: DurableDispatchRuntimeDeps & { organizationId?: string },
): Promise<CloseExpiredUncertainDurableDispatchesResult> {
	const db = deps?.db ?? defaultDb;
	const now = nowInput ?? getNow(deps);
	const cutoff = computeDurableDispatchExpiryCutoff(now);

	const expiryCondition = or(
		and(
			eq(chatNotificationDispatchAttempt.status, "reconciliation_required"),
			sql`COALESCE(${chatNotificationDispatchAttempt.reconciliationRequiredAt}, ${chatNotificationDispatchAttempt.intentRecordedAt}) <= ${cutoff}`,
		),
		and(
			eq(chatNotificationDispatchAttempt.status, "intent_recorded"),
			lte(chatNotificationDispatchAttempt.intentRecordedAt, cutoff),
		),
	);

	const whereClause = deps?.organizationId
		? and(eq(chatNotificationDispatchAttempt.organizationId, deps.organizationId), expiryCondition)
		: expiryCondition;

	const closed = await db
		.update(chatNotificationDispatchAttempt)
		.set({
			status: "closed_unknown",
			unknownClosedAt: now,
			completedAt: sql`COALESCE(${chatNotificationDispatchAttempt.completedAt}, ${now})`,
			failureClassification: sql`COALESCE(${chatNotificationDispatchAttempt.failureClassification}, 'worker_lost')`,
			redactedDiagnostics: sql`COALESCE(${chatNotificationDispatchAttempt.redactedDiagnostics}, '{}'::jsonb) || ${JSON.stringify({ closedReason: "expired_after_7_days" })}::jsonb`,
			updatedAt: now,
		})
		.where(whereClause)
		.returning({
			id: chatNotificationDispatchAttempt.id,
			organizationId: chatNotificationDispatchAttempt.organizationId,
			provider: chatNotificationDispatchAttempt.provider,
			installationId: chatNotificationDispatchAttempt.installationId,
		});

	if (closed.length > 0) {
		logger.warn(
			{
				closedCount: closed.length,
				cutoffAt: cutoff.toISOString(),
				organizationIds: [...new Set(closed.map((row) => row.organizationId))],
			},
			"Closed unresolved uncertain durable chat notification dispatches as closed_unknown after 7 days",
		);
	}

	return {
		closedCount: closed.length,
		closedAttemptIds: closed.map((row) => row.id),
		cutoffAt: cutoff.toISOString(),
	};
}

export interface InFlightDurableDispatchCounts {
	total: number;
	intentRecorded: number;
	reconciliationRequired: number;
}

/**
 * Counts active in-flight (`intent_recorded`) and unresolved uncertain
 * (`reconciliation_required`) durable notification dispatches for an organization
 * and provider (optionally filtered to one installation), used by switch impact previews.
 */
export async function countInFlightDurableDispatches(
	organizationId: string,
	provider: ChatInstallationProvider,
	installationId?: string | null,
	deps?: Pick<DurableDispatchRuntimeDeps, "db">,
): Promise<InFlightDurableDispatchCounts> {
	const db = deps?.db ?? defaultDb;

	const conditions = [
		eq(chatNotificationDispatchAttempt.organizationId, organizationId),
		eq(chatNotificationDispatchAttempt.provider, provider),
		inArray(chatNotificationDispatchAttempt.status, ["intent_recorded", "reconciliation_required"]),
	];
	if (installationId) {
		conditions.push(eq(chatNotificationDispatchAttempt.installationId, installationId));
	}

	const rows = await db
		.select({
			status: chatNotificationDispatchAttempt.status,
			count: sql<number>`count(*)::int`,
		})
		.from(chatNotificationDispatchAttempt)
		.where(and(...conditions))
		.groupBy(chatNotificationDispatchAttempt.status);

	let intentRecorded = 0;
	let reconciliationRequired = 0;
	for (const row of rows) {
		if (row.status === "intent_recorded") {
			intentRecorded = Number(row.count) || 0;
		} else if (row.status === "reconciliation_required") {
			reconciliationRequired = Number(row.count) || 0;
		}
	}

	return {
		total: intentRecorded + reconciliationRequired,
		intentRecorded,
		reconciliationRequired,
	};
}
