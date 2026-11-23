/**
 * Audited statutory acknowledgements (#1988), stored in `contract_review_acknowledgement`:
 * `review_kind` = acknowledgement kind, `subject_key` = what was evaluated (`2026-03`, `2026-W10`,
 * `shift:<id>`…), `input_fingerprint` = `statutoryInputFingerprint(evaluated inputs)`, `note` =
 * the mandatory reason, `legal_note` = optional legal reference or exemption.
 *
 * Rows are immutable (a database trigger refuses updates). Recording the same fingerprint twice
 * is idempotent; a changed fingerprint is recorded as a new row, so the history stays complete.
 * An acknowledgement is `current` when any recorded row matches the fingerprint of the latest
 * evaluation, `stale` when rows exist but none matches, and `none` otherwise.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { type ContractReviewAcknowledgement, contractReviewAcknowledgement } from "@/db/schema";
import { ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryAcknowledgementKind } from "./acknowledgement-kinds";
import { loadEmployeeInOrganization } from "./employee-scope";
import type { StatutoryFinding, StatutoryFindingAcknowledgement } from "./finding";

export interface StatutoryAcknowledgementSubject {
	readonly employeeId: string;
	readonly kind: StatutoryAcknowledgementKind;
	readonly subjectKey: string;
}

export interface StatutoryAcknowledgementRecord {
	readonly id: string;
	readonly employeeId: string;
	readonly kind: StatutoryAcknowledgementKind;
	readonly subjectKey: string;
	readonly inputFingerprint: string;
	readonly acknowledgedBy: string;
	readonly acknowledgedAt: Date;
	readonly reason: string;
	readonly legalNote: string | null;
	readonly employmentHistoryId: string | null;
	readonly metadata: Record<string, unknown>;
}

export type StatutoryAcknowledgementState =
	| { readonly status: "none"; readonly latest: null }
	| {
			readonly status: "current" | "stale";
			/** `current`: the newest row matching the fingerprint; `stale`: the newest row. */
			readonly latest: StatutoryAcknowledgementRecord;
	  };

export interface StatutoryAcknowledgementStates {
	get(subject: StatutoryAcknowledgementSubject): StatutoryAcknowledgementState;
}

export type StatutoryAcknowledgementRefusal = "statutory_reason_required";

function subjectMapKey(subject: StatutoryAcknowledgementSubject): string {
	return JSON.stringify([subject.employeeId, subject.kind, subject.subjectKey]);
}

function toRecord(row: ContractReviewAcknowledgement): StatutoryAcknowledgementRecord {
	return {
		id: row.id,
		employeeId: row.employeeId,
		kind: row.reviewKind as StatutoryAcknowledgementKind,
		subjectKey: row.subjectKey ?? "",
		inputFingerprint: row.inputFingerprint ?? "",
		acknowledgedBy: row.acknowledgedBy,
		acknowledgedAt: row.acknowledgedAt,
		reason: row.note ?? "",
		legalNote: row.legalNote,
		employmentHistoryId: row.employmentHistoryId,
		metadata: row.metadata,
	};
}

/**
 * Records an org admin's acknowledgement of an evaluated finding. The caller authorizes
 * (`organizationAction` with `requires: "orgAdmin"`) and must pass the fingerprint of its own
 * server-side evaluation, never one sent by the client.
 */
export async function recordStatutoryAcknowledgement(
	db: Pick<DatabaseClient, "select" | "insert">,
	input: StatutoryAcknowledgementSubject & {
		readonly organizationId: string;
		readonly actorUserId: string;
		readonly inputFingerprint: string;
		readonly reason: string;
		readonly legalNote?: string | null;
		readonly employmentHistoryId?: string | null;
		/** Admin-only context worth keeping (e.g. evaluated amounts); never shown to scoped managers. */
		readonly metadata?: Record<string, unknown>;
	},
): Promise<StatutoryAcknowledgementRecord> {
	const reason = input.reason.trim();
	if (!reason) {
		throw new ValidationError({
			message: "Explain why the finding is acknowledged",
			field: "reason",
			refusal: "statutory_reason_required" satisfies StatutoryAcknowledgementRefusal,
		});
	}
	await loadEmployeeInOrganization(db, input);

	const dedupeKey = `statutory:${input.kind}:${input.employeeId}:${input.subjectKey}:${input.inputFingerprint}`;
	await db
		.insert(contractReviewAcknowledgement)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			employmentHistoryId: input.employmentHistoryId ?? null,
			reviewKind: input.kind,
			dedupeKey,
			acknowledgedBy: input.actorUserId,
			note: reason,
			legalNote: input.legalNote?.trim() || null,
			subjectKey: input.subjectKey,
			inputFingerprint: input.inputFingerprint,
			metadata: input.metadata ?? {},
		})
		.onConflictDoNothing({
			target: [
				contractReviewAcknowledgement.organizationId,
				contractReviewAcknowledgement.dedupeKey,
			],
		});

	const [row] = await db
		.select()
		.from(contractReviewAcknowledgement)
		.where(
			and(
				eq(contractReviewAcknowledgement.organizationId, input.organizationId),
				eq(contractReviewAcknowledgement.dedupeKey, dedupeKey),
			),
		)
		.limit(1);
	return toRecord(row);
}

/** Acknowledgement history, newest first, optionally narrowed to an employee, kind or subject. */
export async function listStatutoryAcknowledgements(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly employeeId?: string;
		readonly kind?: StatutoryAcknowledgementKind;
		readonly kinds?: readonly StatutoryAcknowledgementKind[];
		readonly subjectKey?: string;
	},
): Promise<StatutoryAcknowledgementRecord[]> {
	const conditions = [
		eq(contractReviewAcknowledgement.organizationId, input.organizationId),
		isNotNull(contractReviewAcknowledgement.inputFingerprint),
	];
	if (input.employeeId)
		conditions.push(eq(contractReviewAcknowledgement.employeeId, input.employeeId));
	if (input.kind) conditions.push(eq(contractReviewAcknowledgement.reviewKind, input.kind));
	if (input.kinds)
		conditions.push(inArray(contractReviewAcknowledgement.reviewKind, [...input.kinds]));
	if (input.subjectKey)
		conditions.push(eq(contractReviewAcknowledgement.subjectKey, input.subjectKey));
	const rows = await db
		.select()
		.from(contractReviewAcknowledgement)
		.where(and(...conditions))
		.orderBy(
			desc(contractReviewAcknowledgement.acknowledgedAt),
			desc(contractReviewAcknowledgement.id),
		);
	return rows.map(toRecord);
}

/** Acknowledgement states for the subjects of one evaluation, in one query. */
export async function loadStatutoryAcknowledgementStates(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly subjects: readonly (StatutoryAcknowledgementSubject & {
			readonly inputFingerprint: string;
		})[];
	},
): Promise<StatutoryAcknowledgementStates> {
	const states = new Map<string, StatutoryAcknowledgementState>();
	if (input.subjects.length > 0) {
		const employeeIds = [...new Set(input.subjects.map((subject) => subject.employeeId))];
		const kinds = [...new Set(input.subjects.map((subject) => subject.kind))];
		const subjectKeys = [...new Set(input.subjects.map((subject) => subject.subjectKey))];
		const rows = await db
			.select()
			.from(contractReviewAcknowledgement)
			.where(
				and(
					eq(contractReviewAcknowledgement.organizationId, input.organizationId),
					inArray(contractReviewAcknowledgement.employeeId, employeeIds),
					inArray(contractReviewAcknowledgement.reviewKind, kinds),
					inArray(contractReviewAcknowledgement.subjectKey, subjectKeys),
					isNotNull(contractReviewAcknowledgement.inputFingerprint),
				),
			)
			.orderBy(
				desc(contractReviewAcknowledgement.acknowledgedAt),
				desc(contractReviewAcknowledgement.id),
			);

		const bySubject = new Map<string, StatutoryAcknowledgementRecord[]>();
		for (const row of rows) {
			const record = toRecord(row);
			const key = subjectMapKey(record);
			bySubject.set(key, [...(bySubject.get(key) ?? []), record]);
		}
		for (const subject of input.subjects) {
			const key = subjectMapKey(subject);
			const records = bySubject.get(key) ?? [];
			const match = records.find((record) => record.inputFingerprint === subject.inputFingerprint);
			states.set(
				key,
				match
					? { status: "current", latest: match }
					: records[0]
						? { status: "stale", latest: records[0] }
						: { status: "none", latest: null },
			);
		}
	}
	return {
		get: (subject) => states.get(subjectMapKey(subject)) ?? { status: "none", latest: null },
	};
}

/**
 * Loads and attaches the acknowledgement state of every acknowledgeable finding. Findings without
 * an `acknowledgementKind` pass through unchanged.
 */
export async function attachAcknowledgementStates<F extends StatutoryFinding>(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	findings: readonly F[],
): Promise<F[]> {
	const subjects = findings.flatMap((finding) =>
		finding.acknowledgementKind
			? [
					{
						employeeId: finding.employeeId,
						kind: finding.acknowledgementKind,
						subjectKey: finding.subjectKey,
						inputFingerprint: finding.inputFingerprint,
					},
				]
			: [],
	);
	const states = await loadStatutoryAcknowledgementStates(db, { organizationId, subjects });
	return findings.map((finding) => {
		if (!finding.acknowledgementKind) return finding;
		const state = states.get({
			employeeId: finding.employeeId,
			kind: finding.acknowledgementKind,
			subjectKey: finding.subjectKey,
		});
		const acknowledgement: StatutoryFindingAcknowledgement = {
			status: state.status,
			acknowledgedAt: state.latest?.acknowledgedAt ?? null,
			acknowledgedBy: state.latest?.acknowledgedBy ?? null,
			reason: state.latest?.reason ?? null,
		};
		return { ...finding, acknowledgement };
	});
}
