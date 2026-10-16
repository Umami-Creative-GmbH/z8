import type {
	KioskFrozenCommand,
	KioskFrozenRefusalReason,
	KioskFrozenSubmission,
} from "./frozen-command";
import { KIOSK_COMMANDS_STORE, kioskDatabaseMayExist, kioskTransaction } from "./kiosk-database";
import type { KioskOfflineAction } from "./offline-command";
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
 * - committed: dropped; refused (or malformed): dropped and reported as a notice,
 *   never resent; unknown (500, no answer): kept;
 * - a transport failure stops the run; a token Z8 never knew (401) is reported.
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
	action: KioskOfflineAction;
	occurredAt: string;
	/** The frozen submission bytes (`KioskFrozenSubmission` as JSON). */
	body: string;
	/** It may have reached Z8: look it up before sending it again. */
	uncertain: boolean;
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
	action: KioskOfflineAction;
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
		action: KioskOfflineAction;
	}): Promise<QueuedKioskCommand>;
	/** The queued commands in order; empty when the storage cannot be read. */
	commands(): Promise<QueuedKioskCommand[]>;
	/** Sends what is queued with the kiosk's token. */
	send(token: string): Promise<KioskQueueSendReport>;
	/**
	 * Sends the queue once with a token Z8 no longer accepts for clocking (revoked,
	 * rotated or unknown), so its commands are judged and listed before the kiosk
	 * forgets the token; then drops what is left. `sent: false` (Z8 not reached)
	 * keeps everything for another try.
	 */
	sendBeforeForgetting(token: string): Promise<{ sent: boolean; report: KioskQueueSendReport }>;
};

/** The frozen command a queued record carries. */
export function frozenCommandOf(record: QueuedKioskCommand): KioskFrozenCommand {
	return (JSON.parse(record.body) as KioskFrozenSubmission).command;
}

const COMMANDS_PATH = "/api/kiosk/commands";

type Outcome =
	| { kind: "committed" }
	| { kind: "refused"; code: KioskQueueNotice["code"] }
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

export function createKioskOfflineQueue(deps: {
	storage: () => KioskQueueStorage;
	fetch?: typeof globalThis.fetch;
}): KioskOfflineQueue {
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

	async function runOnce(token: string): Promise<KioskQueueSendReport> {
		let storage: KioskQueueStorage;
		let records: QueuedKioskCommand[];
		try {
			storage = deps.storage();
			records = await storage.list();
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
			let outcome: Outcome = record.uncertain ? await lookUp(token, record) : { kind: "send" };
			if (outcome.kind === "send") {
				// Marked before it leaves: from now on its outcome is unknown until answered.
				if (!record.uncertain) await storage.update({ ...record, uncertain: true });
				outcome = await submit(token, record);
			}
			switch (outcome.kind) {
				case "committed":
					await storage.remove([record.sequence]);
					report.waiting -= 1;
					report.settled += 1;
					break;
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
				case "unknown":
					waitingEmployees.add(record.employeeId);
					break;
				case "unreachable":
					return { ...report, unreachable: true };
				case "kiosk_unknown":
					return { ...report, kioskUnknown: true };
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

	return {
		async enqueue({ submission, employeeName, action }) {
			const record: Omit<QueuedKioskCommand, "sequence"> = {
				operationId: submission.command.operationId,
				kioskId: submission.command.kioskId,
				employeeId: submission.command.employeeId,
				employeeName,
				action,
				occurredAt: submission.command.occurredAt,
				body: JSON.stringify(submission),
				uncertain: false,
			};
			const sequence = await deps.storage().add(record);
			return { ...record, sequence };
		},

		async commands() {
			try {
				return await deps.storage().list();
			} catch {
				return [];
			}
		},

		send: (token) =>
			serialized(async () => {
				try {
					return await runOnce(token);
				} catch {
					return { ...emptyReport(), unreachable: true };
				}
			}),

		sendBeforeForgetting: (token) =>
			serialized(async () => {
				let report: KioskQueueSendReport;
				try {
					report = await runOnce(token);
				} catch {
					return { sent: false, report: { ...emptyReport(), unreachable: true } };
				}
				if (report.unreachable) return { sent: false, report };
				try {
					const storage = deps.storage();
					const left = await storage.list();
					await storage.remove(left.map((record) => record.sequence));
				} catch {
					// Nothing more can be done with a token Z8 no longer accepts.
				}
				return { sent: true, report: { ...report, waiting: 0 } };
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
