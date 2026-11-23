import type { Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import { attachAcknowledgementStates } from "../acknowledgements";
import type { StatutoryFinding } from "../finding";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import { safeSummary } from "../redaction";
import type {
	StatutoryProposedShift,
	StatutoryScheduleContext,
	StatutoryScheduleContributor,
} from "./contributor";
import { statutoryScheduleContributors } from "./contributors";
import { statutoryFindingChangeKey } from "./finding-key";

type Reader = Pick<DatabaseClient, "select">;

export interface StatutoryScheduleRequest {
	readonly organizationId: string;
	readonly timezone: string;
	readonly window: StatutoryScheduleContext["window"];
	readonly employeeIds: readonly string[];
	readonly now: Instant;
	readonly proposedShifts?: readonly StatutoryProposedShift[];
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
		summary: safeSummary(finding.summary),
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
		replacesShiftId: request.replacesShiftId ?? null,
		preferences,
		now: request.now,
	};
	// One after another: `db` may be a transaction (one connection).
	const findings: StatutoryFinding[] = [];
	for (const contributor of contributors) {
		findings.push(...(await contributor.evaluate(context)));
	}
	return attachAcknowledgementStates(db, request.organizationId, findings);
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

	const key = (finding: StatutoryFinding) =>
		statutoryFindingChangeKey(toStatutoryComplianceFinding(finding));
	const baseline = new Set((await runContributors(db, request, contributors)).map(key));
	const proposed = await runContributors(
		db,
		{
			...request,
			proposedShifts: request.employeeIds.map((employeeId) => ({
				employeeId,
				...request.proposedShift,
			})),
		},
		contributors,
	);
	for (const finding of proposed) {
		if (baseline.has(key(finding))) continue;
		added.set(finding.employeeId, [
			...(added.get(finding.employeeId) ?? []),
			toStatutoryComplianceFinding(finding),
		]);
	}
	return added;
}
