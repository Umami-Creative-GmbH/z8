/**
 * Audited statutory acknowledgements (#1988), stored in `contract_review_acknowledgement`:
 * `review_kind` = acknowledgement kind, `finding_kind` = the monitor finding kind it documents,
 * `subject_key` = what was evaluated (`2026-03`, `2026-W10`, `shift:<id>`…), `input_fingerprint`
 * = `statutoryInputFingerprint(evaluated inputs)`, `note` = the mandatory reason, `legal_note` =
 * optional legal reference or exemption.
 *
 * One subject is one finding: employee + acknowledgement kind + finding kind + subject key. Several
 * findings may share an acknowledgement kind and subject key (night and Sunday work on one shift
 * are both `jarbschg_sector_exception` on `shift:<id>`), and each is acknowledged on its own.
 *
 * Rows are immutable (a database trigger refuses updates and direct deletes) and belong to the
 * employee, never to an employment history row or agreement, so cancelling terms cannot cascade
 * into the audit trail; only deleting the employee or organization removes them. Recording the same
 * fingerprint twice is idempotent; a changed fingerprint is recorded as a new row, so the history
 * stays complete. An acknowledgement is `current` when any row of the subject matches the
 * fingerprint of the latest evaluation, `stale` when the subject has rows but none matches, and
 * `none` otherwise.
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
	/** The finding kind acknowledged, e.g. `minijob_monthly_cap` or `jarbschg_night_work`. */
	readonly findingKind: string;
	readonly subjectKey: string;
}

export interface StatutoryAcknowledgementRecord extends StatutoryAcknowledgementSubject {
	readonly id: string;
	readonly inputFingerprint: string;
	readonly acknowledgedBy: string;
	readonly acknowledgedAt: Date;
	readonly reason: string;
	readonly legalNote: string | null;
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

export type StatutoryAcknowledgementRefusal =
	| "statutory_reason_required"
	| "statutory_subject_required";

/** The acknowledgement subject of an acknowledgeable finding (null when it has no kind). */
export function statutoryAcknowledgementSubjectOf(
	finding: Pick<StatutoryFinding, "employeeId" | "kind" | "subjectKey" | "acknowledgementKind">,
): StatutoryAcknowledgementSubject | null {
	if (!finding.acknowledgementKind) return null;
	return {
		employeeId: finding.employeeId,
		kind: finding.acknowledgementKind,
		findingKind: finding.kind,
		subjectKey: finding.subjectKey,
	};
}

function subjectMapKey(subject: StatutoryAcknowledgementSubject): string {
	return JSON.stringify([
		subject.employeeId,
		subject.kind,
		subject.findingKind,
		subject.subjectKey,
	]);
}

function toRecord(row: ContractReviewAcknowledgement): StatutoryAcknowledgementRecord {
	return {
		id: row.id,
		employeeId: row.employeeId,
		kind: row.reviewKind as StatutoryAcknowledgementKind,
		findingKind: row.findingKind ?? "",
		subjectKey: row.subjectKey ?? "",
		inputFingerprint: row.inputFingerprint ?? "",
		acknowledgedBy: row.acknowledgedBy,
		acknowledgedAt: row.acknowledgedAt,
		reason: row.note ?? "",
		legalNote: row.legalNote,
		metadata: row.metadata,
	};
}

/**
 * Records an org admin's acknowledgement of an evaluated finding. The caller authorizes
 * (`organizationAction` with `requires: "orgAdmin"`) and must pass the subject and fingerprint of
 * its own server-side evaluation (`statutoryAcknowledgementSubjectOf(finding)`), never values sent
 * by the client.
 */
export async function recordStatutoryAcknowledgement(
	db: Pick<DatabaseClient, "select" | "insert">,
	input: StatutoryAcknowledgementSubject & {
		readonly organizationId: string;
		readonly actorUserId: string;
		readonly inputFingerprint: string;
		readonly reason: string;
		readonly legalNote?: string | null;
		/** Admin-only context worth keeping (e.g. evaluated amounts); never shown to scoped managers. */
		readonly metadata?: Record<string, unknown>;
		/**
		 * Distinguishes acknowledgements of the same fingerprint that document different figures
		 * (e.g. a Minijob month's total), so documenting the new figures records a new row instead
		 * of deduplicating onto the old one.
		 */
		readonly revision?: string;
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
	// Rows are immutable, so a caller bug must not persist an acknowledgement of nothing.
	const missing = (
		[
			["subjectKey", input.subjectKey],
			["findingKind", input.findingKind],
			["inputFingerprint", input.inputFingerprint],
		] as const
	).find(([, value]) => !value.trim());
	if (missing) {
		throw new ValidationError({
			message: "An acknowledgement needs the evaluated finding, subject and input fingerprint",
			field: missing[0],
			refusal: "statutory_subject_required" satisfies StatutoryAcknowledgementRefusal,
		});
	}
	await loadEmployeeInOrganization(db, input);

	const dedupeKey = `statutory:${JSON.stringify([
		input.kind,
		input.findingKind,
		input.employeeId,
		input.subjectKey,
		input.inputFingerprint,
		...(input.revision ? [input.revision] : []),
	])}`;
	await db
		.insert(contractReviewAcknowledgement)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			reviewKind: input.kind,
			dedupeKey,
			acknowledgedBy: input.actorUserId,
			note: reason,
			legalNote: input.legalNote?.trim() || null,
			findingKind: input.findingKind,
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

/**
 * Acknowledgement history, newest first, optionally narrowed to an employee, kind, finding kind or
 * subject.
 */
export async function listStatutoryAcknowledgements(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly employeeId?: string;
		readonly kind?: StatutoryAcknowledgementKind;
		readonly kinds?: readonly StatutoryAcknowledgementKind[];
		readonly findingKind?: string;
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
	if (input.findingKind)
		conditions.push(eq(contractReviewAcknowledgement.findingKind, input.findingKind));
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
		const distinct = <T>(pick: (subject: StatutoryAcknowledgementSubject) => T) => [
			...new Set(input.subjects.map(pick)),
		];
		const rows = await db
			.select()
			.from(contractReviewAcknowledgement)
			.where(
				and(
					eq(contractReviewAcknowledgement.organizationId, input.organizationId),
					inArray(
						contractReviewAcknowledgement.employeeId,
						distinct((s) => s.employeeId),
					),
					inArray(
						contractReviewAcknowledgement.reviewKind,
						distinct((s) => s.kind),
					),
					inArray(
						contractReviewAcknowledgement.findingKind,
						distinct((s) => s.findingKind),
					),
					inArray(
						contractReviewAcknowledgement.subjectKey,
						distinct((s) => s.subjectKey),
					),
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
 * an `acknowledgementKind` pass through unchanged, and so do findings whose contributor already
 * attached a state it judged beyond the fingerprint (e.g. Minijob months, by acknowledged total).
 */
export async function attachAcknowledgementStates<F extends StatutoryFinding>(
	db: Pick<DatabaseClient, "select">,
	organizationId: string,
	findings: readonly F[],
): Promise<F[]> {
	const subjects = findings.flatMap((finding) => {
		const subject = finding.acknowledgement ? null : statutoryAcknowledgementSubjectOf(finding);
		return subject ? [{ ...subject, inputFingerprint: finding.inputFingerprint }] : [];
	});
	const states = await loadStatutoryAcknowledgementStates(db, { organizationId, subjects });
	return findings.map((finding) => {
		const subject = statutoryAcknowledgementSubjectOf(finding);
		if (!subject || finding.acknowledgement) return finding;
		const state = states.get(subject);
		const acknowledgement: StatutoryFindingAcknowledgement = {
			status: state.status,
			acknowledgedAt: state.latest?.acknowledgedAt ?? null,
			acknowledgedBy: state.latest?.acknowledgedBy ?? null,
			reason: state.latest?.reason ?? null,
		};
		return { ...finding, acknowledgement };
	});
}
