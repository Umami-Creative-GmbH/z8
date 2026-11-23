import type { Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { attachAcknowledgementStates } from "../acknowledgements";
import type { StatutoryFinding } from "../finding";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { restrictedSummary } from "../redaction";
import type {
	StatutoryProposedShift,
	StatutoryScheduleContext,
	StatutoryScheduleContributor,
} from "./contributor";
import { statutoryScheduleContributors } from "./contributors";
import { statutoryFindingChangeKey } from "./finding-key";

type Reader = Pick<DatabaseClient, "select" | "query">;

export interface StatutoryScheduleRequest {
	readonly organizationId: string;
	readonly timezone: string;
	readonly window: StatutoryScheduleContext["window"];
	readonly employeeIds: readonly string[];
	readonly now: Instant;
	readonly proposedShifts?: readonly StatutoryProposedShift[];
	readonly comparedProposedShifts?: readonly StatutoryProposedShift[];
	readonly replacesShiftId?: string | null;
}

/** The wage-free Scheduling projection of a statutory finding. */
export function toStatutoryComplianceFinding(
	finding: StatutoryFinding,
): StatutoryComplianceFinding {
	return {
		type: "statutory",
		employeeId: finding.employeeId,
		findingId: finding.id,
		statutoryKind: finding.kind,
		domain: finding.domain,
		severity: finding.severity,
		subjectKey: finding.subjectKey,
		legalReference: finding.legalReference,
		// Planners and scoped managers read this: only the documented wage-free fields pass.
		summary: restrictedSummary(finding),
		acknowledgementStatus: finding.acknowledgementKind
			? (finding.acknowledgement?.status ?? "none")
			: null,
		blocksPublication: finding.blocksPublication ?? false,
	};
}

async function runContributors(
	db: Reader,
	request: StatutoryScheduleRequest,
	contributors: readonly StatutoryScheduleContributor[],
): Promise<StatutoryFinding[]> {
	const preferences = await loadOrganizationStatutoryPreferences(db, request.organizationId);
	const context: StatutoryScheduleContext = {
		db,
		organizationId: request.organizationId,
		timezone: request.timezone,
		window: request.window,
		employeeIds: request.employeeIds,
		proposedShifts: request.proposedShifts ?? [],
		comparedProposedShifts: request.comparedProposedShifts,
		replacesShiftId: request.replacesShiftId ?? null,
		preferences,
		now: request.now,
	};
	// One after another: `db` may be a transaction (one connection).
	const findings: StatutoryFinding[] = [];
	for (const contributor of contributors) {
		findings.push(...(await contributor.evaluate(context)));
	}
	const acknowledged = await attachAcknowledgementStates(db, request.organizationId, findings);
	// A current acknowledgement (e.g. a JArbSchG sector exception) lifts the publication block.
	return acknowledged.map((finding) =>
		finding.blocksPublication && finding.acknowledgement?.status === "current"
			? { ...finding, blocksPublication: false }
			: finding,
	);
}

/**
 * Statutory findings for the judged window, projected for Scheduling (publish evaluation,
 * compliance banner). Without contributors or employees it does no database work.
 */
export async function evaluateStatutoryScheduleFindings(
	db: Reader,
	request: StatutoryScheduleRequest,
	contributors: readonly StatutoryScheduleContributor[] = statutoryScheduleContributors,
): Promise<StatutoryComplianceFinding[]> {
	if (contributors.length === 0 || request.employeeIds.length === 0) return [];
	return (await runContributors(db, request, contributors)).map(toStatutoryComplianceFinding);
}

/**
 * The statutory findings each candidate would get if `proposedShift` were assigned to them,
 * minus those they already have unchanged. A finding counts as added when the proposal raises
 * its severity or tier (e.g. 96 % → over the cap), invalidates its acknowledgement, or makes it
 * block publication. Used by Staffing.
 *
 * It also counts as added when it keeps that state but the proposal deepens a limit already
 * exceeded: the visible summary has `used` and `limit` in the same unit, `used > limit`, and
 * `used` grows (e.g. a lecture week at 22 h → 30 h). Under-limit findings (an on-call under-band)
 * and earnings-derived findings (tier only) are unaffected.
 *
 * The baseline run gets the proposals as `comparedProposedShifts` (never counted), so a
 * contributor can judge the same subjects in both runs.
 */
export async function addedStatutoryScheduleFindings(
	db: Reader,
	request: Omit<StatutoryScheduleRequest, "proposedShifts"> & {
		readonly proposedShift: Omit<StatutoryProposedShift, "employeeId">;
	},
	contributors: readonly StatutoryScheduleContributor[] = statutoryScheduleContributors,
): Promise<Map<string, StatutoryComplianceFinding[]>> {
	const added = new Map<string, StatutoryComplianceFinding[]>();
	if (contributors.length === 0 || request.employeeIds.length === 0) return added;

	const proposedShifts = request.employeeIds.map((employeeId) => ({
		employeeId,
		...request.proposedShift,
	}));
	const baseline = new Map(
		(
			await runContributors(
				db,
				{ ...request, comparedProposedShifts: proposedShifts },
				contributors,
			)
		).map((finding) => {
			const projected = toStatutoryComplianceFinding(finding);
			return [statutoryFindingChangeKey(projected), projected] as const;
		}),
	);
	const proposed = await runContributors(db, { ...request, proposedShifts }, contributors);
	for (const finding of proposed) {
		const projected = toStatutoryComplianceFinding(finding);
		const before = baseline.get(statutoryFindingChangeKey(projected));
		if (before && !deepensExceededLimit(before, projected)) continue;
		added.set(finding.employeeId, [...(added.get(finding.employeeId) ?? []), projected]);
	}
	return added;
}

/** `after` is over its visible limit and uses more of it than `before`, in the same unit. */
function deepensExceededLimit(
	before: StatutoryComplianceFinding,
	after: StatutoryComplianceFinding,
): boolean {
	const { used, limit } = after.summary;
	const usedBefore = before.summary.used;
	const limitBefore = before.summary.limit;
	if (!used || !limit || !usedBefore || !limitBefore) return false;
	if (new Set([used.unit, limit.unit, usedBefore.unit, limitBefore.unit]).size !== 1) return false;
	return used.value > limit.value && used.value > usedBefore.value;
}
