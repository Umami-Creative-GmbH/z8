/**
 * Builds Scheduling's statutory findings list (#2026) for one viewer: only employees the viewer
 * may see, named by the user-name rule, ordered so what blocks this publication and what is
 * critical comes first. Server-side; the items it returns are the wage-free Scheduling projection.
 */
import { and, eq, inArray } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { ManagedScope } from "@/lib/organization-action/managed-scope";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import type { StatutorySeverity } from "../finding";
import type { StatutoryAudience } from "../redaction";
import type {
	DatedStatutoryFinding,
	ScheduleStatutoryFindingItem,
	ScheduleStatutoryFindings,
	StatutoryFindingPeriod,
} from "./findings-list";

/** Who reads the list: whom they reach, and whether they are an org admin. */
export interface ScheduleStatutoryFindingsViewer {
	readonly scope: ManagedScope;
	readonly audience: StatutoryAudience;
}

const SEVERITY_ORDER: Record<StatutorySeverity, number> = { critical: 0, warning: 1, info: 2 };

function inScope(scope: ManagedScope, employeeId: string): boolean {
	return scope.organizationWide || scope.employeeIds.has(employeeId);
}

/** The day a youth or apprentice finding names, as a one-day period. */
function namedDayPeriod(finding: StatutoryComplianceFinding): StatutoryFindingPeriod | null {
	const day = finding.day ?? finding.releaseDay;
	if (!day) return null;
	return { start: day, endExclusive: parsePlainDate(day).add({ days: 1 }).toString() };
}

/** One finding on one day: a finding of a week or a shift through two days has one per day. */
function datedFindingKey(finding: StatutoryComplianceFinding): string {
	return `${finding.findingId}|${finding.day ?? finding.releaseDay ?? ""}`;
}

function compareItems(a: ScheduleStatutoryFindingItem, b: ScheduleStatutoryFindingItem): number {
	return (
		Number(b.blocksThisPublication) - Number(a.blocksThisPublication) ||
		SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] ||
		a.employeeName.localeCompare(b.employeeName) ||
		a.finding.employeeId.localeCompare(b.finding.employeeId) ||
		(a.period?.start ?? "").localeCompare(b.period?.start ?? "") ||
		a.finding.findingId.localeCompare(b.finding.findingId)
	);
}

/**
 * The list `viewer` may read of `findings`. A finding without a known period (a publish-block
 * refusal judges afresh) takes the period of the same finding in `dated`, else the day it names.
 */
export async function scheduleStatutoryFindingsFor(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly viewer: ScheduleStatutoryFindingsViewer;
		readonly findings: readonly DatedStatutoryFinding[];
		/** Where to look up the period of a finding that came without one. */
		readonly dated?: readonly DatedStatutoryFinding[];
		/**
		 * What publishing the range's drafts is refused for (`findingsBlockingPublication`): the
		 * refusal's own findings, none when nothing blocked it.
		 */
		readonly blockingThisPublication: readonly StatutoryComplianceFinding[];
	},
): Promise<ScheduleStatutoryFindings> {
	const visible = input.findings.filter(({ finding }) =>
		inScope(input.viewer.scope, finding.employeeId),
	);
	const employeeIds = [...new Set(visible.map(({ finding }) => finding.employeeId))];
	const rows =
		employeeIds.length === 0
			? []
			: await db
					.select({
						id: employee.id,
						firstName: user.firstName,
						lastName: user.lastName,
						name: user.name,
						email: user.email,
					})
					.from(employee)
					.innerJoin(user, eq(user.id, employee.userId))
					.where(
						and(
							eq(employee.organizationId, input.organizationId),
							inArray(employee.id, employeeIds),
						),
					);
	const names = new Map(rows.map((row) => [row.id, buildAuthUserDisplayName(row)]));
	const knownPeriods = new Map(
		(input.dated ?? []).flatMap(({ finding, period }) =>
			period ? [[datedFindingKey(finding), period]] : [],
		),
	);
	const blocking = new Set(input.blockingThisPublication.map(datedFindingKey));

	// The findings are this organization's: one whose employee has no name on record (removed since
	// it was judged) is still the viewer's to see, unnamed. The names query reads this organization
	// only, so it names no one else's employee.
	const items = visible
		.map(({ finding, period }) => ({
			finding,
			period: period ?? knownPeriods.get(datedFindingKey(finding)) ?? namedDayPeriod(finding),
			employeeName: names.get(finding.employeeId) ?? "",
			blocksThisPublication: blocking.has(datedFindingKey(finding)),
		}))
		.toSorted(compareItems);

	return {
		items,
		outsideScopeCount: input.findings.length - items.length,
		canOpenReviews: input.viewer.audience === "full",
	};
}
