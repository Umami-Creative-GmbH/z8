import {
	type Clock,
	compareInstants,
	type Instant,
	instantToCanonicalString,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	type KioskFrozenCommand,
	type KioskFrozenRefusalReason,
	type KioskFrozenSubmission,
	parseKioskFrozenSubmission,
} from "./frozen-command";
import type { KioskAction } from "./kiosk-actions";
import { KIOSK_COMMANDS_STORE, kioskDatabaseMayExist, kioskTransaction } from "./kiosk-database";
import { kioskOfflineClock } from "./offline-clock";
import { KIOSK_TOKEN_HEADER } from "./protocol";

/**
 * The offline kiosk's queue of frozen kiosk commands (#1292, spec #885, ADR
 * 0011), in the kiosk's own IndexedDB (`commands` store). Each command is frozen
 * once, when the employee acts, and its submission bytes (`body`: the command,
 * the sealed PIN and the contact anchor, never a plaintext PIN) are sent
 * unchanged on every attempt to `POST /api/kiosk/commands`.
 *
 * Sending, at each contact:
 * - in queue order, one run at a time; an employee whose command has an unknown
 *   outcome waits (their later commands may depend on it), others go on;
 * - a command is marked `uncertain` before it is sent, and an uncertain one is
 *   looked up (`GET /api/kiosk/commands/{operationId}`) before it is sent again,
 *   so a lost answer never commits twice;
 * - committed: confirmed, and kept applied to the offline view until a cached
 *   state learned after it arrives (`forgetConfirmedBefore`); refused (or
 *   malformed): dropped and reported as a notice, never resent; unknown (500, no
 *   answer): kept;
 * - 429 `retry_later` (the arrival throttle, ADR 0011): kept, not resent before
 *   its `retryAfter`, and the employee's later commands wait behind it;
 * - a transport failure stops the run; a token Z8 never knew (401) is reported.
 *
 * Each command keeps the device token the kiosk had when it was queued, and is
 * only ever sent with that token: after the kiosk is paired again, a revoked or
 * rotated kiosk's commands are still sent once with its old token
 * (`sendRetired`), so Z8 refuses and lists them for that kiosk, never with the
 * new kiosk's token.
 *
 * Clearing the kiosk's cache never touches the queue: a kiosk switched to
 * offline mode off still sends what it queued.
 */

export type QueuedKioskCommand = {
	/** Queue order. */
	sequence: number;
	operationId: string;
	kioskId: string;
	employeeId: string;
	/** For the notice if Z8 refuses it. */
	employeeName: string;
	/** What the employee pressed (`end_day` is a clock-out). */
	action: KioskAction;
	occurredAt: string;
	/** The frozen submission bytes (`KioskFrozenSubmission` as JSON). */
	body: string;
	/** It may have reached Z8: look it up before sending it again. */
	uncertain: boolean;
	/** The device token the kiosk had when it queued the command; it is sent with this one only. */
	token?: string;
	/**
	 * When Z8 confirmed it (the kiosk's offline clock, UTC ISO): no longer sent, but
	 * applied to the offline view until a cached state learned after it arrives.
	 */
	confirmedAt?: string;
	/** Throttled on arrival (ADR 0011): not sent again before this device instant (UTC ISO). */
	notBefore?: string;
};

/** The `commands` store of the kiosk's IndexedDB. */
export type KioskQueueStorage = {
	/** Every queued command in queue order. */
	list(): Promise<QueuedKioskCommand[]>;
	/** Adds a command at the end of the queue; answers its sequence. */
	add(record: Omit<QueuedKioskCommand, "sequence">): Promise<number>;
	update(record: QueuedKioskCommand): Promise<void>;
	remove(sequences: readonly number[]): Promise<void>;
};

/** Why a queued command was dropped without committing, as the kiosk shows it. */
export type KioskQueueNotice = {
	operationId: string;
	employeeName: string;
	action: KioskAction;
	occurredAt: string;
	/** A refusal reason, or `invalid_request`/`unsupported_version` for a command Z8 could not read. */
	code: KioskFrozenRefusalReason | "invalid_request" | "unsupported_version";
};

export type KioskQueueSendReport = {
	/** Commands this run settled (committed or refused). */
	settled: number;
	refused: KioskQueueNotice[];
	/** Commands still queued after the run. */
	waiting: number;
	/** The run stopped because Z8 could not be reached. */
	unreachable: boolean;
	/** Z8 does not know the kiosk's token (401): nothing can be sent with it. */
	kioskUnknown: boolean;
};

export type KioskOfflineQueue = {
	/** Freezes a command at the end of the queue. Throws when it cannot be stored. */
	enqueue(input: {
		submission: KioskFrozenSubmission;
		employeeName: string;
		action: KioskAction;
		/** The kiosk's device token now: the command is only ever sent with it. */
		token?: string;
	}): Promise<QueuedKioskCommand>;
	/** The commands Z8 has not confirmed yet, in order; empty when the storage cannot be read. */
	commands(): Promise<QueuedKioskCommand[]>;
	/** The commands Z8 confirmed that the offline view still applies, in order. */
	confirmed(): Promise<QueuedKioskCommand[]>;
	/** A cached state learned at `learnedAt` (server time) arrived: drops what it already shows. */
	forgetConfirmedBefore(kioskId: string, learnedAt: string): Promise<void>;
	/**
	 * Sends what is queued with the kiosk's token: the commands queued under it (and,
	 * given `kioskId`, only that kiosk's). Commands of another token are left for
	 * `sendRetired`.
	 */
	send(token: string, kioskId?: string): Promise<KioskQueueSendReport>;
	/**
	 * Sends the commands queued under a token Z8 no longer accepts for clocking
	 * (revoked, rotated or unknown) once, so they are judged and listed before the
	 * kiosk forgets the token; then drops what is left of them. `sent: false` (Z8
	 * not reached) keeps everything for another try.
	 */
	sendBeforeForgetting(token: string): Promise<{ sent: boolean; report: KioskQueueSendReport }>;
	/**
	 * At a contact: sends, once each, the commands still queued under any token
	 * other than `current` (a kiosk revoked or rotated, then paired again before
	 * they could be sent).
	 */
	sendRetired(current: string): Promise<KioskQueueSendReport>;
};

/**
 * The frozen command a queued record carries, or null when its stored bytes are
 * not a submission this kiosk could have frozen (corrupt storage). Such a record
 * is still sent unchanged: Z8 refuses it as `invalid_request` and it is dropped.
 */
export function readFrozenCommand(record: QueuedKioskCommand): KioskFrozenCommand | null {
	let body: unknown;
	try {
		body = JSON.parse(record.body);
	} catch {
		return null;
	}
	const parsed = parseKioskFrozenSubmission(body);
	return parsed.ok ? parsed.submission.command : null;
}

/** The frozen commands queued records carry, in order, leaving out unreadable ones. */
export function frozenCommandsOf(records: readonly QueuedKioskCommand[]): KioskFrozenCommand[] {
	return records.flatMap((record) => {
		const command = readFrozenCommand(record);
		return command ? [command] : [];
	});
}

/** The frozen command a queued record carries; throws when its stored bytes are unreadable. */
export function frozenCommandOf(record: QueuedKioskCommand): KioskFrozenCommand {
	const command = readFrozenCommand(record);
	if (!command) throw new Error(`Queued kiosk command ${record.operationId} is unreadable`);
	return command;
}

const COMMANDS_PATH = "/api/kiosk/commands";
/** A throttled command waits at most this long, whatever the device clock did meanwhile. */
const MAX_RETRY_WAIT_MS = 16 * 60_000;

type Outcome =
	| { kind: "committed" }
	| { kind: "refused"; code: KioskQueueNotice["code"] }
	| { kind: "retry_later"; retryAfterSeconds: number }
	| { kind: "send" }
	| { kind: "unknown" }
	| { kind: "unreachable" }
	| { kind: "kiosk_unknown" };

async function bodyOf(response: Response): Promise<Record<string, unknown> | null> {
	const body = (await response.json().catch(() => null)) as unknown;
	return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

/** What an answer to `POST /api/kiosk/commands` means for the queued command. */
async function submitOutcome(response: Response): Promise<Outcome> {
	if (response.status === 401) return { kind: "kiosk_unknown" };
	const body = await bodyOf(response);
	if (response.ok && (body?.outcome === "executed" || body?.outcome === "replayed")) {
		return { kind: "committed" };
	}
	if (response.status === 429 && body?.outcome === "retry_later") {
		const seconds = typeof body.retryAfter === "number" ? body.retryAfter : 60;
		return { kind: "retry_later", retryAfterSeconds: Math.max(1, seconds) };
	}
	if (body?.outcome === "refused" && typeof body.code === "string") {
		return { kind: "refused", code: body.code as KioskFrozenRefusalReason };
	}
	if (
		(response.status === 400 && body?.code === "invalid_request") ||
		(response.status === 422 && body?.code === "unsupported_version")
	) {
		return { kind: "refused", code: body.code };
	}
	return { kind: "unknown" };
}

/** What `GET /api/kiosk/commands/{operationId}` says about an uncertain command. */
async function lookupOutcome(response: Response): Promise<Outcome> {
	if (response.status === 401) return { kind: "kiosk_unknown" };
	const body = await bodyOf(response);
	if (!response.ok || !body) return { kind: "unknown" };
	switch (body.outcome) {
		case "committed":
			return { kind: "committed" };
		case "refused":
			return typeof body.code === "string"
				? { kind: "refused", code: body.code as KioskFrozenRefusalReason }
				: { kind: "unknown" };
		case "conflict":
			return { kind: "refused", code: "collision" };
		case "not_committed":
			return { kind: "send" };
		default:
			return { kind: "unknown" };
	}
}

/** A stored instant, or null when it is unreadable. */
function readInstant(value: string): Instant | null {
	try {
		return parseInstant(value);
	} catch {
		return null;
	}
}

/** Whether a record is sent with `token`: its own token, or (queued before tokens were kept) any. */
const queuedUnder = (record: QueuedKioskCommand, token: string) =>
	(record.token ?? token) === token;

export function createKioskOfflineQueue(deps: {
	storage: () => KioskQueueStorage;
	fetch?: typeof globalThis.fetch;
	/** The kiosk's time now, as its offline clock tells it (UTC ISO). */
	now?: () => string;
	/** The device clock, for throttle waits. */
	device?: Clock;
}): KioskOfflineQueue {
	const now = deps.now ?? (() => kioskOfflineClock.now().occurredAt);
	const device = deps.device ?? systemClock;
	const send = (url: string, token: string, init: RequestInit) => {
		const headers = new Headers(init.headers);
		headers.set(KIOSK_TOKEN_HEADER, token);
		return (deps.fetch ?? globalThis.fetch)(url, { ...init, headers, cache: "no-store" });
	};

	async function attempt(run: () => Promise<Response>, read: typeof submitOutcome) {
		try {
			return await read(await run());
		} catch {
			return { kind: "unreachable" } as const;
		}
	}

	async function lookUp(token: string, record: QueuedKioskCommand): Promise<Outcome> {
		return attempt(
			() =>
				send(`${COMMANDS_PATH}/${encodeURIComponent(record.operationId)}`, token, {
					headers: { accept: "application/json" },
				}),
			lookupOutcome,
		);
	}

	async function submit(token: string, record: QueuedKioskCommand): Promise<Outcome> {
		return attempt(
			() =>
				send(COMMANDS_PATH, token, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json" },
					body: record.body,
				}),
			submitOutcome,
		);
	}

	/** Whether a throttled record still waits; a wait longer than any throttle is over. */
	function stillWaiting(record: QueuedKioskCommand): boolean {
		const until = record.notBefore ? readInstant(record.notBefore) : null;
		if (!until) return false;
		const remaining = until.epochMilliseconds - device.nowInstant().epochMilliseconds;
		return remaining > 0 && remaining <= MAX_RETRY_WAIT_MS;
	}

	async function runOnce(
		token: string,
		selects: (record: QueuedKioskCommand) => boolean,
	): Promise<KioskQueueSendReport> {
		let storage: KioskQueueStorage;
		let records: QueuedKioskCommand[];
		try {
			storage = deps.storage();
			records = (await storage.list()).filter(
				(record) => !record.confirmedAt && queuedUnder(record, token) && selects(record),
			);
		} catch {
			// No readable queue (no IndexedDB, blocked site data): nothing to send.
			return emptyReport();
		}
		const report: KioskQueueSendReport = {
			settled: 0,
			refused: [],
			waiting: records.length,
			unreachable: false,
			kioskUnknown: false,
		};
		if (records.length === 0) return report;
		if (typeof navigator !== "undefined" && navigator.onLine === false) {
			return { ...report, unreachable: true };
		}
		const waitingEmployees = new Set<string>();
		for (const record of records) {
			if (waitingEmployees.has(record.employeeId)) continue;
			if (stillWaiting(record)) {
				waitingEmployees.add(record.employeeId);
				continue;
			}
			let outcome: Outcome = record.uncertain ? await lookUp(token, record) : { kind: "send" };
			if (outcome.kind === "send") {
				// Marked before it leaves: from now on its outcome is unknown until answered.
				if (!record.uncertain) await storage.update({ ...record, uncertain: true });
				outcome = await submit(token, record);
			}
			switch (outcome.kind) {
				case "committed": {
					await storage.update({
						...record,
						uncertain: false,
						notBefore: undefined,
						confirmedAt: now(),
					});
					report.waiting -= 1;
					report.settled += 1;
					break;
				}
				case "refused":
					await storage.remove([record.sequence]);
					report.waiting -= 1;
					report.settled += 1;
					report.refused.push({
						operationId: record.operationId,
						employeeName: record.employeeName,
						action: record.action,
						occurredAt: record.occurredAt,
						code: outcome.code,
					});
					break;
				case "retry_later":
					// Not judged: resend the same bytes after the wait, nothing to look up.
					await storage.update({
						...record,
						uncertain: false,
						notBefore: instantToCanonicalString(
							device.nowInstant().add({ seconds: outcome.retryAfterSeconds }),
						),
					});
					waitingEmployees.add(record.employeeId);
					break;
				case "unknown":
					waitingEmployees.add(record.employeeId);
					break;
				case "unreachable":
					return { ...report, unreachable: true };
				case "kiosk_unknown":
					return { ...report, kioskUnknown: true };
				case "send":
					break;
			}
		}
		return report;
	}

	// One run at a time: a contact while a run is still sending waits for it.
	let running: Promise<unknown> = Promise.resolve();
	function serialized<T>(run: () => Promise<T>): Promise<T> {
		const next = running.then(run, run);
		running = next.catch(() => undefined);
		return next;
	}

	const emptyReport = (): KioskQueueSendReport => ({
		settled: 0,
		refused: [],
		waiting: 0,
		unreachable: false,
		kioskUnknown: false,
	});

	async function listed(filter: (record: QueuedKioskCommand) => boolean) {
		try {
			return (await deps.storage().list()).filter(filter);
		} catch {
			return [];
		}
	}

	/** Sends a retired token's commands once, then drops what is left of them. */
	async function sendOnceBeforeForgetting(token: string) {
		let report: KioskQueueSendReport;
		try {
			report = await runOnce(token, () => true);
		} catch {
			return { sent: false, report: { ...emptyReport(), unreachable: true } };
		}
		if (report.unreachable) return { sent: false, report };
		try {
			const storage = deps.storage();
			const left = (await storage.list()).filter((record) => queuedUnder(record, token));
			await storage.remove(left.map((record) => record.sequence));
		} catch {
			// Nothing more can be done with a token Z8 no longer accepts.
		}
		return { sent: true, report: { ...report, waiting: 0 } };
	}

	return {
		async enqueue({ submission, employeeName, action, token }) {
			const record: Omit<QueuedKioskCommand, "sequence"> = {
				operationId: submission.command.operationId,
				kioskId: submission.command.kioskId,
				employeeId: submission.command.employeeId,
				employeeName,
				action,
				occurredAt: submission.command.occurredAt,
				body: JSON.stringify(submission),
				uncertain: false,
				...(token ? { token } : {}),
			};
			const sequence = await deps.storage().add(record);
			return { ...record, sequence };
		},

		commands: () => listed((record) => !record.confirmedAt),

		confirmed: () => listed((record) => Boolean(record.confirmedAt)),

		async forgetConfirmedBefore(kioskId, learnedAt) {
			try {
				const learned = parseInstant(learnedAt);
				const storage = deps.storage();
				const shown = (await storage.list()).filter((record) => {
					const confirmedAt = record.confirmedAt ? readInstant(record.confirmedAt) : null;
					return (
						record.kioskId === kioskId &&
						confirmedAt !== null &&
						compareInstants(confirmedAt, learned) < 0
					);
				});
				await storage.remove(shown.map((record) => record.sequence));
			} catch {
				// Kept until the next cached state: applying it again changes nothing.
			}
		},

		send: (token, kioskId) =>
			serialized(async () => {
				try {
					return await runOnce(token, (record) => !kioskId || record.kioskId === kioskId);
				} catch {
					return { ...emptyReport(), unreachable: true };
				}
			}),

		sendBeforeForgetting: (token) => serialized(() => sendOnceBeforeForgetting(token)),

		sendRetired: (current) =>
			serialized(async () => {
				const retired = [
					...new Set(
						(await listed((record) => !record.confirmedAt))
							.map((record) => record.token)
							.filter((token): token is string => token !== undefined && token !== current),
					),
				];
				const total = emptyReport();
				for (const token of retired) {
					const { report } = await sendOnceBeforeForgetting(token);
					total.settled += report.settled;
					total.refused.push(...report.refused);
					total.waiting += report.waiting;
					total.unreachable ||= report.unreachable;
					if (report.unreachable) break;
				}
				return total;
			}),
	};
}
/** The `commands` store of the kiosk's IndexedDB. */
export function indexedDbKioskQueueStorage(): KioskQueueStorage {
	if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available");
	return {
		async list() {
			// A kiosk that never had offline mode has no database; reading must not create one.
			if (!(await kioskDatabaseMayExist())) return [];
			return (
				(await kioskTransaction<QueuedKioskCommand[]>(
					KIOSK_COMMANDS_STORE,
					"readonly",
					(transaction) =>
						transaction.objectStore(KIOSK_COMMANDS_STORE).getAll() as IDBRequest<
							QueuedKioskCommand[]
						>,
				)) ?? []
			);
		},
		async add(record) {
			const key = await kioskTransaction<IDBValidKey>(
				KIOSK_COMMANDS_STORE,
				"readwrite",
				(transaction) => transaction.objectStore(KIOSK_COMMANDS_STORE).add(record),
			);
			return Number(key);
		},
		async update(record) {
			await kioskTransaction(KIOSK_COMMANDS_STORE, "readwrite", (transaction) =>
				transaction.objectStore(KIOSK_COMMANDS_STORE).put(record),
			);
		},
		async remove(sequences) {
			if (sequences.length === 0) return;
			await kioskTransaction(KIOSK_COMMANDS_STORE, "readwrite", (transaction) => {
				const store = transaction.objectStore(KIOSK_COMMANDS_STORE);
				for (const sequence of sequences) store.delete(sequence);
				return undefined;
			});
		},
	};
}

/** The kiosk page's queue, in the kiosk's IndexedDB. */
export const kioskOfflineQueue: KioskOfflineQueue = createKioskOfflineQueue({
	storage: indexedDbKioskQueueStorage,
});
