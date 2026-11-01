import { and, eq } from "drizzle-orm";
import { workPolicy, workPolicyAssignment } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadEffectiveWorkPolicies } from "@/lib/work-policy/effective-work-policies";
import type { GoLiveFailureGroup, GoLiveFixLink, GoLiveMember } from "../types";
import type { GoLiveCheck } from "./types";

/** The work-policy assignments tab, where a missing policy is fixed. */
export const WORK_POLICY_ASSIGNMENTS_HREF = "/settings/work-policies?tab=work&view=assignments";

/**
 * Who a member resolves as. An invitee has no employee record yet: their draft
 * id never matches an employee assignment, so they resolve by their draft team,
 * then at organization level.
 */
function policySubject(member: GoLiveMember) {
	return member.kind === "employee"
		? { id: member.employeeId, teamId: member.primaryTeamId }
		: { id: member.draftId, teamId: member.teamId };
}

/**
 * Work policy (mandatory): every member has an effective work policy today,
 * resolved employee, then primary team (an invitee's draft team), then
 * organization. Members without one are grouped by team; with no policy at
 * any level, nobody in that team (or in no team) is covered.
 */
export const workPolicyGoLiveCheck: GoLiveCheck = {
	id: "work-policy",
	itemId: "work-policies",
	severity: "mandatory",
	async run({ db, organizationId, asOf, group, fixLink }) {
		const [configured, policies] = await Promise.all([
			hasWorkPolicySettings(db, organizationId),
			loadEffectiveWorkPolicies(db, {
				organizationId,
				employees: group.members.map(policySubject),
				at: asOf.instant,
			}),
		]);

		const uncovered = Map.groupBy(
			group.members.filter((member) => !policies.get(policySubject(member).id)),
			(member) => policySubject(member).teamId,
		);
		const fix = fixLink(WORK_POLICY_ASSIGNMENTS_HREF, {
			key: "settings.implementationChecklist.goLive.workPolicy.fix",
			fallback: "Assign work policies",
		});
		const failures = [...uncovered].map(([teamId, members]) =>
			uncoveredGroup(teamId, teamId ? group.teamNames.get(teamId) : undefined, members, fix),
		);

		return {
			outcome: failures.length ? "failed" : "passed",
			configured,
			failures,
			warnings: [],
			notes: [],
		};
	},
};

function uncoveredGroup(
	teamId: string | null,
	teamName: string | undefined,
	members: GoLiveMember[],
	fix: GoLiveFixLink | null,
): GoLiveFailureGroup {
	const affected = members.map((member) => ({ member }));
	const count = members.length;
	if (!teamId) {
		return {
			cause: "work-policy:no-team",
			reason: {
				key: "settings.implementationChecklist.goLive.workPolicy.noTeamNoOrganizationPolicy",
				fallback:
					"No organization work policy: {count, plural, one {# employee} other {# employees}} in no team",
				params: { count },
			},
			members: affected,
			fix,
		};
	}
	return {
		cause: `work-policy:team:${teamId}`,
		reason: teamName
			? {
					key: "settings.implementationChecklist.goLive.workPolicy.teamWithoutPolicy",
					fallback:
						"Team {team} has no work policy: {count, plural, one {# employee} other {# employees}}",
					params: { team: teamName, count },
				}
			: {
					key: "settings.implementationChecklist.goLive.workPolicy.unknownTeamWithoutPolicy",
					fallback:
						"Their team has no work policy: {count, plural, one {# employee} other {# employees}}",
					params: { count },
				},
		members: affected,
		fix,
	};
}

/** Whether any work policy or assignment is set up: the item is configured, not yet verified. */
async function hasWorkPolicySettings(db: DatabaseClient, organizationId: string) {
	const [policies, assignments] = await Promise.all([
		db
			.select({ id: workPolicy.id })
			.from(workPolicy)
			.where(and(eq(workPolicy.organizationId, organizationId), eq(workPolicy.isActive, true)))
			.limit(1),
		db
			.select({ id: workPolicyAssignment.id })
			.from(workPolicyAssignment)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, organizationId),
					eq(workPolicyAssignment.isActive, true),
				),
			)
			.limit(1),
	]);
	return policies.length > 0 || assignments.length > 0;
}
