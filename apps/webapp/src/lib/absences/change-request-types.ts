import type { AbsenceDayRange } from "./absence-days";

export type AbsenceChangeKind = "change" | "cancel";
export type AbsenceChangeStatus =
	| "pending"
	| "approved"
	| "rejected"
	| "withdrawn"
	| "obsolete"
	| "expired";
export interface AbsenceChangeOriginal extends AbsenceDayRange {
	categoryId: string;
	canonicalRecordId: string | null;
	updatedAt: string;
	canonical: { startAt: string; endAt: string } | null;
}
export interface AbsenceChangeProposal extends AbsenceDayRange {
	historicalReconciliation?: import("./vacation-reconciliation.types").ReconciliationProof;
	historicalReconciliationReview?: {
		reason: string;
		totals: {
			year: number;
			currentDays: number;
			remainingDays: number | undefined;
			datedDays: number;
		}[];
		balances: { year: number; before: number | null; after: number | null }[];
	};
	canonical: { startAt: string; endAt: string };
	displacedVacations: Array<
		AbsenceDayRange & { id: string; updatedAt: string; status: string }
	>;
}
export interface AbsenceChangeRequestInput {
	historicalReconciliation?: import("./vacation-reconciliation.types").ReconciliationProof;
	absenceId: string;
	kind: AbsenceChangeKind;
	proposed?: AbsenceDayRange;
	coverage?: "keep" | "choose";
	reason: string;
}
export interface AbsenceChangeSummary {
	id: string;
	absenceId: string;
	kind: AbsenceChangeKind;
	status: AbsenceChangeStatus;
	original: AbsenceChangeOriginal;
	proposed: AbsenceChangeProposal | null;
	reason: string;
	decisionReason: string | null;
	createdAt: string;
	decidedAt: string | null;
	deciderName: string | null;
}

export class AbsenceChangeError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "AbsenceChangeError";
	}
}
