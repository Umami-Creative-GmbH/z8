import {
	MANUAL_ENTRY_APPROVAL_UNROUTABLE,
	MANUAL_ENTRY_COLLISION,
	MANUAL_ENTRY_CONTEXT_MISMATCH,
	MANUAL_ENTRY_EMPLOYEE_NOT_FOUND,
	MANUAL_ENTRY_NOT_ADOPTED,
	MANUAL_ENTRY_NOT_AUTHENTICATED,
	MANUAL_ENTRY_REFRESH_REQUIRED,
	MANUAL_ENTRY_TARGET_NOT_AUTHORIZED,
	type ManualTimeEntryLookup,
	type ManualTimeEntryResult,
} from "@/app/[locale]/(app)/time-tracking/actions/types";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

/**
 * Tab-local recovery of frozen version-2 manual commands (#310 / T45, #258 §8).
 *
 * A command is frozen once, after zone and occurrence confirmation, and stored
 * before its first request in this tab's session storage, keyed by the signed-in
 * user, organization and target. Every later attempt sends exactly those bytes
 * under the same identity. The editable draft is never stored here, and nothing
 * here resends on its own: retries and lookups are explicit user actions.
 *
 * The guarantee ends with the tab or at sign-out. There is no cross-tab or
 * offline queue.
 */

export const MANUAL_RECOVERY_KEY_PREFIX = "z8.manual-entry-recovery.v1:";

export interface ManualRecoveryScope {
	userId: string;
	organizationId: string;
	targetEmployeeId: string;
}

/**
 * - `uncertain`: an attempt was sent and may have committed.
 * - `not_committed`: the server established that nothing committed under the identity.
 * - `conflict`: the identity names other work or changed evidence; inspect, never recreate.
 * - `unsupported`: no supported matcher could answer; not proof of absence.
 */
export type ManualRecoveryStatus = "uncertain" | "not_committed" | "conflict" | "unsupported";

export interface ManualRecoveryRecord {
	version: 1;
	scope: ManualRecoveryScope;
	submissionId: string;
	/** The serialized command; every attempt sends exactly this. */
	command: string;
	frozenAt: string;
	attempts: number;
	status: ManualRecoveryStatus;
	/** The code of the last answer worth showing, if any. */
	code: string | null;
}

/** What one attempt proves about the identity. */
export type ManualAttemptVerdict =
	| { kind: "committed" }
	| { kind: "not_committed"; code: string | null }
	| { kind: "conflict" }
	/** Refused before the identity was reached; says nothing about earlier attempts. */
	| { kind: "refused"; code: string }
	| { kind: "uncertain" };

export type ManualLookupVerdict =
	| { kind: "committed" }
	| { kind: "not_committed"; code: null }
	| { kind: "conflict" }
	| { kind: "unsupported" }
	| { kind: "refused"; code: string }
	| { kind: "unanswered" };

/** Minimal storage port; `tabRecoveryStorage` adapts session storage. */
export interface RecoveryStorage {
	read(key: string): string | null;
	write(key: string, value: string): void;
	remove(key: string): void;
	keys(): string[];
}

// Survives dialog closure and client navigation when session storage is unavailable.
const pageMemory = new Map<string, string>();

function sessionStorageOrNull(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.sessionStorage;
	} catch {
		return null;
	}
}

/** This tab's session storage, falling back to page memory when it refuses. */
export function tabRecoveryStorage(): RecoveryStorage {
	const session = sessionStorageOrNull();
	return {
		read(key) {
			try {
				const value = session?.getItem(key);
				if (value !== null && value !== undefined) return value;
			} catch {}
			return pageMemory.get(key) ?? null;
		},
		write(key, value) {
			try {
				if (session) {
					session.setItem(key, value);
					pageMemory.delete(key);
					return;
				}
			} catch {}
			pageMemory.set(key, value);
		},
		remove(key) {
			try {
				session?.removeItem(key);
			} catch {}
			pageMemory.delete(key);
		},
		keys() {
			const keys = new Set(pageMemory.keys());
			try {
				if (session) {
					for (let index = 0; index < session.length; index += 1) {
						const key = session.key(index);
						if (key !== null) keys.add(key);
					}
				}
			} catch {}
			return [...keys];
		},
	};
}

function scopePrefix(scope: ManualRecoveryScope) {
	return `${MANUAL_RECOVERY_KEY_PREFIX}${JSON.stringify([
		scope.userId,
		scope.organizationId,
		scope.targetEmployeeId,
	])}:`;
}

function recordKey(record: Pick<ManualRecoveryRecord, "scope" | "submissionId">) {
	return `${scopePrefix(record.scope)}${record.submissionId}`;
}

function sameScope(left: ManualRecoveryScope, right: ManualRecoveryScope) {
	return (
		left.userId === right.userId &&
		left.organizationId === right.organizationId &&
		left.targetEmployeeId === right.targetEmployeeId
	);
}

const STATUSES: readonly ManualRecoveryStatus[] = [
	"uncertain",
	"not_committed",
	"conflict",
	"unsupported",
];

function parseRecord(value: string | null): ManualRecoveryRecord | null {
	if (value === null) return null;
	try {
		const record = JSON.parse(value) as ManualRecoveryRecord;
		if (
			record?.version !== 1 ||
			typeof record.submissionId !== "string" ||
			typeof record.command !== "string" ||
			typeof record.frozenAt !== "string" ||
			typeof record.attempts !== "number" ||
			!STATUSES.includes(record.status) ||
			typeof record.scope?.userId !== "string" ||
			typeof record.scope.organizationId !== "string" ||
			typeof record.scope.targetEmployeeId !== "string"
		) {
			return null;
		}
		return record;
	} catch {
		return null;
	}
}

function persist(storage: RecoveryStorage, record: ManualRecoveryRecord) {
	storage.write(recordKey(record), JSON.stringify(record));
	return record;
}

/** Freeze a confirmed command for its scope. Nothing is stored until the first attempt begins. */
export function freezeManualCommand(
	scope: ManualRecoveryScope,
	command: ManualTimeEntryCommand,
	frozenAt: string,
): ManualRecoveryRecord {
	if (command.targetEmployeeId !== scope.targetEmployeeId) {
		throw new Error("A frozen manual command must belong to its recovery target");
	}
	return {
		version: 1,
		scope: { ...scope },
		submissionId: command.submissionId,
		command: JSON.stringify(command),
		frozenAt,
		attempts: 0,
		status: "uncertain",
		code: null,
	};
}

/** The exact command an attempt sends. */
export function frozenManualCommand(record: ManualRecoveryRecord): ManualTimeEntryCommand {
	return JSON.parse(record.command) as ManualTimeEntryCommand;
}

/** Recoverable commands of exactly this user, organization and target, oldest first. */
export function listManualRecoveries(
	storage: RecoveryStorage,
	scope: ManualRecoveryScope,
): ManualRecoveryRecord[] {
	const prefix = scopePrefix(scope);
	return storage
		.keys()
		.filter((key) => key.startsWith(prefix))
		.flatMap((key) => {
			const record = parseRecord(storage.read(key));
			return record && sameScope(record.scope, scope) && recordKey(record) === key ? [record] : [];
		})
		.sort((left, right) =>
			left.frozenAt === right.frozenAt
				? left.submissionId.localeCompare(right.submissionId)
				: left.frozenAt.localeCompare(right.frozenAt),
		);
}

/**
 * Store the record as uncertain before a request leaves, so a reload or a lost
 * response during the request still finds it.
 */
export function beginManualAttempt(
	storage: RecoveryStorage,
	record: ManualRecoveryRecord,
): ManualRecoveryRecord {
	return persist(storage, { ...record, attempts: record.attempts + 1, status: "uncertain" });
}

/**
 * Settle an attempt. `previous` is the record before this attempt, or null
 * for the first attempt from the form, whose draft is still on screen.
 */
export function settleManualAttempt(
	storage: RecoveryStorage,
	input: {
		previous: ManualRecoveryRecord | null;
		begun: ManualRecoveryRecord;
		verdict: ManualAttemptVerdict;
	},
): ManualRecoveryRecord | null {
	const { previous, begun, verdict } = input;
	const remove = () => {
		storage.remove(recordKey(begun));
		return null;
	};
	switch (verdict.kind) {
		case "committed":
			return remove();
		case "not_committed":
			return previous === null
				? remove()
				: persist(storage, { ...begun, status: "not_committed", code: verdict.code });
		case "conflict":
			return persist(storage, { ...begun, status: "conflict", code: MANUAL_ENTRY_COLLISION });
		case "refused":
			return previous === null
				? remove()
				: persist(storage, { ...begun, status: previous.status, code: verdict.code });
		case "uncertain":
			return persist(storage, { ...begun, status: "uncertain", code: null });
	}
}

/** Settle a lookup. It never changes the frozen command or the attempt count. */
export function settleManualLookup(
	storage: RecoveryStorage,
	record: ManualRecoveryRecord,
	verdict: ManualLookupVerdict,
): ManualRecoveryRecord | null {
	switch (verdict.kind) {
		case "committed":
			storage.remove(recordKey(record));
			return null;
		case "not_committed":
		case "conflict":
		case "unsupported":
			return persist(storage, {
				...record,
				status: verdict.kind,
				code: verdict.kind === "conflict" ? MANUAL_ENTRY_COLLISION : null,
			});
		case "refused":
			return persist(storage, { ...record, code: verdict.code });
		case "unanswered":
			return record;
	}
}

/** An uncertain command stays until a retry or lookup resolves it. */
export function canDiscardManualRecovery(record: ManualRecoveryRecord) {
	return record.status !== "uncertain";
}

export function discardManualRecovery(storage: RecoveryStorage, record: ManualRecoveryRecord) {
	if (!canDiscardManualRecovery(record)) {
		throw new Error("An uncertain manual command cannot be discarded");
	}
	storage.remove(recordKey(record));
}

/** Sign-out ends the tab's recovery guarantee for every account. */
export function clearManualRecoveries(storage: RecoveryStorage = tabRecoveryStorage()) {
	for (const key of storage.keys()) {
		if (key.startsWith(MANUAL_RECOVERY_KEY_PREFIX)) storage.remove(key);
	}
}

/** Refusals that happen before the submission identity is read. */
const PRE_IDENTITY_CODES = new Set<string>([
	MANUAL_ENTRY_CONTEXT_MISMATCH,
	MANUAL_ENTRY_TARGET_NOT_AUTHORIZED,
	MANUAL_ENTRY_NOT_AUTHENTICATED,
	MANUAL_ENTRY_EMPLOYEE_NOT_FOUND,
	"invalid_command",
]);

/** Answers given after replay recognition under the identity, with nothing written. */
const NOT_COMMITTED_CODES = new Set<string>([
	MANUAL_ENTRY_NOT_ADOPTED,
	MANUAL_ENTRY_REFRESH_REQUIRED,
	MANUAL_ENTRY_APPROVAL_UNROUTABLE,
]);

/** What a submission response proves; a thrown request is `undefined`. */
export function submissionVerdict(result: ManualTimeEntryResult | undefined): ManualAttemptVerdict {
	if (!result) return { kind: "uncertain" };
	if (result.success) return { kind: "committed" };
	if (result.code === MANUAL_ENTRY_COLLISION) return { kind: "conflict" };
	// The billing gate reports its reason as the code.
	if (result.error === "billing_required") return { kind: "refused", code: "billing_required" };
	const code = result.code ?? null;
	if (code !== null && PRE_IDENTITY_CODES.has(code)) return { kind: "refused", code };
	if (code !== null && NOT_COMMITTED_CODES.has(code)) return { kind: "not_committed", code };
	if (result.rejection) return { kind: "not_committed", code: result.rejection.reason };
	// A generic failure may surface after a commit.
	return { kind: "uncertain" };
}

export function lookupVerdict(result: ManualTimeEntryLookup | undefined): ManualLookupVerdict {
	switch (result?.status) {
		case "committed":
			return { kind: "committed" };
		case "not_committed":
			return { kind: "not_committed", code: null };
		case "conflict":
			return { kind: "conflict" };
		case "unsupported":
			return { kind: "unsupported" };
		case "refused":
			return { kind: "refused", code: result.code };
		default:
			return { kind: "unanswered" };
	}
}
