/**
 * The record agreement rule (`record-agreement.ts`) for readers that judge stored
 * history: work diagnostics and the cutover reconciliation (#1217). Pure, no I/O.
 *
 * The rule refuses rows that break the work attribution invariants (a billable
 * flag or a task without a project). History can still hold such rows, so a
 * reader reports them here instead of failing: the side that cannot be
 * represented is named, and the facets that do not depend on it are still judged.
 */
import {
	type AgreementCanonicalRecord,
	type AgreementWorkPeriod,
	type RecordAgreementFacet,
	recordAgreement,
} from "./record-agreement";
import {
	type CanonicalWorkDetailColumns,
	type UnrepresentableWorkAttribution,
	UnrepresentableWorkAttributionError,
	WorkAttribution,
} from "./work-attribution";

/** A side of the pair whose stored attribution breaks the attribution invariants. */
export type UnrepresentableRecordSide = {
	side: "work_period" | "canonical";
	reason: UnrepresentableWorkAttribution;
};

export type RecordAgreementDiagnosis = {
	agrees: boolean;
	/** The rule's disagreeing facets, in its order. */
	disagreements: RecordAgreementFacet[];
	unrepresentable: UnrepresentableRecordSide[];
};

/** A canonical work record as stored; `detail` is null when its detail row is missing. */
export type StoredCanonicalRecord = Omit<AgreementCanonicalRecord, "detail"> & {
	detail: CanonicalWorkDetailColumns | null;
};

/** The facets that compare the work attribution. */
const ATTRIBUTION_FACETS: ReadonlySet<RecordAgreementFacet> = new Set([
	"project",
	"task",
	"billable",
	"allocation_weight",
	"work_category",
	"work_location",
	"vehicle_use",
]);

const NO_ATTRIBUTION = WorkAttribution.fromWorkPeriod({
	projectId: null,
	taskId: null,
	isBillable: false,
	workCategoryId: null,
	workLocationType: null,
	vehicleKind: null,
	vehicleId: null,
	odometerStartKm: null,
	odometerEndKm: null,
	drivenDistanceKm: null,
});

/**
 * Judges a completed work period against its canonical work record. A record
 * whose detail row is missing has no work attribution to compare: the reader
 * reports the missing detail on its own, and only interval, duration and approval
 * state are judged.
 */
export function diagnoseRecordAgreement(
	period: AgreementWorkPeriod,
	canonical: StoredCanonicalRecord,
): RecordAgreementDiagnosis {
	const detail = canonical.detail ?? NO_ATTRIBUTION.canonicalDetail();
	const periodSide = attempt(() => WorkAttribution.fromWorkPeriod(period));
	const canonicalSide = attempt(() => WorkAttribution.fromCanonical(detail, canonical.allocations));
	const unrepresentable: UnrepresentableRecordSide[] = [
		...("refused" in periodSide
			? [{ side: "work_period" as const, reason: periodSide.refused }]
			: []),
		...("refused" in canonicalSide
			? [{ side: "canonical" as const, reason: canonicalSide.refused }]
			: []),
	];

	// Only the project, task and billable flag can be unrepresentable. An
	// unrepresentable side borrows them from the other side (or books no project),
	// so every facet that can still be compared is judged.
	const standIn =
		"value" in periodSide
			? periodSide.value
			: "value" in canonicalSide
				? canonicalSide.value
				: NO_ATTRIBUTION;
	const { projectId, taskId, isBillable } = standIn.workPeriodColumns();
	const comparablePeriod =
		"value" in periodSide ? period : { ...period, projectId, taskId, isBillable };
	const comparableCanonical: AgreementCanonicalRecord = {
		record: canonical.record,
		detail,
		allocations:
			"value" in canonicalSide
				? canonical.allocations
				: standIn.canonicalAllocations(canonical.allocations),
	};

	const disagreements = recordAgreement(comparablePeriod, comparableCanonical).disagreements.filter(
		(facet) => canonical.detail !== null || !ATTRIBUTION_FACETS.has(facet),
	);
	return {
		agrees: disagreements.length === 0 && unrepresentable.length === 0,
		disagreements,
		unrepresentable,
	};
}

type Attempt = { value: WorkAttribution } | { refused: UnrepresentableWorkAttribution };

function attempt(build: () => WorkAttribution): Attempt {
	try {
		return { value: build() };
	} catch (error) {
		if (error instanceof UnrepresentableWorkAttributionError) return { refused: error.reason };
		throw error;
	}
}
