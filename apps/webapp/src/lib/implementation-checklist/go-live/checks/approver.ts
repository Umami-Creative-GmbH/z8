import {
	type ApproverGoLiveKind,
	type ApproverSkipReason,
	type ApproverUnroutableCause,
	loadApproverRouting,
} from "../approver-routing";
import { readOnlyGoLive } from "../read-only";
import type {
	GoLiveFailureGroup,
	GoLiveFixLink,
	GoLiveFixLinkResolver,
	GoLiveGroup,
	GoLiveMember,
	GoLiveMessage,
} from "../types";
import type { GoLiveCheck } from "./types";

export const APPROVAL_POLICIES_HREF = "/settings/approval-policies";
export const EMPLOYEES_HREF = "/settings/employees";
export const TRAVEL_EXPENSES_HREF = "/settings/travel-expenses";
export const CHANGE_POLICIES_HREF = "/settings/work-policies?tab=changes";

/** The ICU `select` value each kind's messages name it by. */
export const APPROVER_KIND_LABEL: Record<ApproverGoLiveKind, string> = {
	absence: "absence",
	time_correction: "timeCorrection",
	manual_time_submission: "workPeriod",
	period_submission: "periodSubmission",
	travel_expense: "expenseReport",
	shift_request: "shiftRequest",
};

/**
 * Approver (mandatory): every member of the go-live group can get each covered approval kind
 * decided, as submitting would route it now. Kinds switched off are not checked; built-in skips
 * pass with a note. Failures are grouped by kind and cause; a member failing several kinds is
 * listed under each. Worked out in one read-only transaction, so nothing can be written.
 */
export const approverGoLiveCheck: GoLiveCheck = {
	id: "approver",
	itemId: "approval-rules",
	severity: "mandatory",
	async run({ db, organizationId, asOf, group, fixLink }) {
		return readOnlyGoLive(db, async (reader) => {
			const routing = await loadApproverRouting(reader, {
				organizationId,
				asOf,
				members: group.members,
			});
			const failures = new Map<string, FailureBucket>();
			const skips = new Map<
				string,
				{ kind: ApproverGoLiveKind; reason: ApproverSkipReason; count: number }
			>();
			for (const member of group.members) {
				const resolutions = await routing.resolve(member);
				for (const [kind, resolution] of resolutions) {
					if (resolution.status === "unroutable") {
						const key = bucketKey(kind, resolution.cause, member);
						const bucket = failures.get(key) ?? {
							kind,
							cause: resolution.cause,
							teamId: memberTeamId(member),
							members: [],
						};
						bucket.members.push(member);
						failures.set(key, bucket);
					} else if (resolution.status === "skipped") {
						const key = `${kind}:${resolution.reason}`;
						const skip = skips.get(key) ?? { kind, reason: resolution.reason, count: 0 };
						skip.count += 1;
						skips.set(key, skip);
					}
				}
			}

			return {
				outcome: failures.size > 0 ? "failed" : "passed",
				// Routing always has a default (the employee's manager), so the item is set up.
				configured: true,
				failures: [...failures].map(([key, bucket]) => failureGroup(key, bucket, group, fixLink)),
				warnings: [],
				notes: [
					...routing.offKinds.map(offKindNote),
					...[...skips.values()].map((skip) => skipNote(skip.kind, skip.reason, skip.count)),
				],
			};
		});
	},
};

type FailureBucket = {
	kind: ApproverGoLiveKind;
	cause: ApproverUnroutableCause;
	teamId: string | null;
	members: GoLiveMember[];
};

function memberTeamId(member: GoLiveMember) {
	return member.kind === "employee" ? member.primaryTeamId : member.teamId;
}

function bucketKey(kind: ApproverGoLiveKind, cause: ApproverUnroutableCause, member: GoLiveMember) {
	switch (cause.code) {
		case "no_default_approver": {
			const teamId = memberTeamId(member);
			return `approver:${kind}:no-manager:${teamId ? `team:${teamId}` : "no-team"}`;
		}
		case "policy_unresolvable":
			return `approver:${kind}:policy:${cause.policyId}`;
		default:
			return `approver:${kind}:${cause.code.replaceAll("_", "-")}`;
	}
}

function failureGroup(
	cause: string,
	bucket: FailureBucket,
	group: GoLiveGroup,
	fixLink: GoLiveFixLinkResolver,
): GoLiveFailureGroup {
	const count = bucket.members.length;
	const kind = APPROVER_KIND_LABEL[bucket.kind];
	const members = bucket.members.map((member) => ({ member }));
	const fix = approverFixLink(bucket.cause, bucket.teamId, fixLink);
	const build = (reason: GoLiveMessage) => ({ cause, reason, members, fix });

	switch (bucket.cause.code) {
		case "no_default_approver": {
			const teamName = bucket.teamId ? group.teamNames.get(bucket.teamId) : undefined;
			if (bucket.teamId) {
				return build(
					teamName
						? {
								key: "settings.implementationChecklist.goLive.approver.teamWithoutManager",
								fallback:
									"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: team {team} has no eligible manager: {count, plural, one {# employee} other {# employees}}",
								params: { kind, team: teamName, count },
							}
						: {
								key: "settings.implementationChecklist.goLive.approver.unknownTeamWithoutManager",
								fallback:
									"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: their team has no eligible manager: {count, plural, one {# employee} other {# employees}}",
								params: { kind, count },
							},
				);
			}
			return build({
				key: "settings.implementationChecklist.goLive.approver.noManagerNoTeam",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: no eligible manager: {count, plural, one {# employee} other {# employees}} in no team",
				params: { kind, count },
			});
		}
		case "default_approver_departed":
			return build({
				key: "settings.implementationChecklist.goLive.approver.managerDeparted",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: their manager has left and nobody stands in: {count, plural, one {# employee} other {# employees}}",
				params: { kind, count },
			});
		case "policy_unresolvable":
			return build({
				key: "settings.implementationChecklist.goLive.approver.policyWithoutApprover",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: approval policy {policy} finds no approver: {count, plural, one {# employee} other {# employees}}",
				params: { kind, policy: bucket.cause.policyName, count },
			});
		case "invalid_policies":
			return build({
				key: "settings.implementationChecklist.goLive.approver.invalidPolicies",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: the approval policies can't be applied: {count, plural, one {# employee} other {# employees}}",
				params: { kind, count },
			});
		case "self_approval_route":
			return build({
				key: "settings.implementationChecklist.goLive.approver.selfApprovalRoute",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: would go to the employees themselves, which isn't allowed: {count, plural, one {# employee} other {# employees}}",
				params: { kind, count },
			});
		case "approval_mode_unsupported":
			return build({
				key: "settings.implementationChecklist.goLive.approver.approvalModeUnsupported",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: can't be submitted in this organization's approval mode. Contact support: {count, plural, one {# employee} other {# employees}}",
				params: { kind, count },
			});
		case "no_decider":
			return build({
				key: "settings.implementationChecklist.goLive.approver.noDecider",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: no manager or admin can decide them: {count, plural, one {# employee} other {# employees}}",
				params: { kind, count },
			});
		case "change_policy_ambiguous":
			return build({
				key: "settings.implementationChecklist.goLive.approver.changePolicyAmbiguous",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: more than one change policy applies, so entries are refused: {count, plural, one {# employee} other {# employees}}",
				params: { kind, count },
			});
	}
}

/**
 * The settings page that fixes an unroutable cause, or null when it is not a settings change
 * (the approval mode) or the viewer may not open the page. The go-live rehearsal offers the same.
 */
export function approverFixLink(
	cause: ApproverUnroutableCause,
	teamId: string | null,
	fixLink: GoLiveFixLinkResolver,
): GoLiveFixLink | null {
	const managersFix = () =>
		fixLink(EMPLOYEES_HREF, {
			key: "settings.implementationChecklist.goLive.approver.fixManagers",
			fallback: "Assign managers",
		});
	const policiesFix = () =>
		fixLink(APPROVAL_POLICIES_HREF, {
			key: "settings.implementationChecklist.goLive.approver.fixApprovalPolicies",
			fallback: "Review approval policies",
		});
	switch (cause.code) {
		case "no_default_approver":
			return teamId
				? fixLink(`/settings/teams/${teamId}`, {
						key: "settings.implementationChecklist.goLive.approver.fixTeamManager",
						fallback: "Set the team's manager",
					})
				: managersFix();
		case "default_approver_departed":
		case "no_decider":
			return managersFix();
		case "policy_unresolvable":
		case "invalid_policies":
			return policiesFix();
		case "self_approval_route":
			return fixLink(TRAVEL_EXPENSES_HREF, {
				key: "settings.implementationChecklist.goLive.approver.fixExpenseApprover",
				fallback: "Set an expense approver",
			});
		case "approval_mode_unsupported":
			// The approval mode is changed by Z8 support, not on a settings page.
			return null;
		case "change_policy_ambiguous":
			return fixLink(CHANGE_POLICIES_HREF, {
				key: "settings.implementationChecklist.goLive.approver.fixChangePolicies",
				fallback: "Review change policies",
			});
	}
}

function offKindNote(kind: ApproverGoLiveKind): GoLiveMessage {
	return kind === "period_submission"
		? {
				key: "settings.implementationChecklist.goLive.approver.periodSubmissionsOff",
				fallback: "Period submissions are off, so they aren't checked.",
			}
		: {
				key: "settings.implementationChecklist.goLive.approver.shiftsOff",
				fallback: "Shifts are off, so shift requests aren't checked.",
			};
}

function skipNote(
	kind: ApproverGoLiveKind,
	reason: ApproverSkipReason,
	count: number,
): GoLiveMessage {
	const params = { kind: APPROVER_KIND_LABEL[kind], count };
	switch (reason) {
		case "change_policy_no_policy":
			return {
				key: "settings.implementationChecklist.goLive.approver.skipNoChangePolicy",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: {count, plural, one {# employee} other {# employees}} need no approval, because no change policy applies.",
				params,
			};
		case "change_policy_trust_mode":
			return {
				key: "settings.implementationChecklist.goLive.approver.skipTrustMode",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: {count, plural, one {# employee} other {# employees}} need no approval, because their change policy is in trust mode.",
				params,
			};
		case "change_policy_within_self_service":
			return {
				key: "settings.implementationChecklist.goLive.approver.skipSelfService",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: {count, plural, one {# employee} other {# employees}} need no approval, because their change policy only allows changes within its self-service days.",
				params,
			};
		case "owner_admin_self":
			return {
				key: "settings.implementationChecklist.goLive.approver.skipOwnerAdmin",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: {count, plural, one {# employee} other {# employees}} need no approval, because owners and admins record their own work directly.",
				params,
			};
		case "no_category_requires_approval":
			return {
				key: "settings.implementationChecklist.goLive.approver.skipNoCategoryRequiresApproval",
				fallback: "Absence requests need no approval, because no absence category requires it.",
			};
		case "requester_is_approver":
			return {
				key: "settings.implementationChecklist.goLive.approver.skipOwnApprover",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: {count, plural, one {# employee} other {# employees}} are their own approver.",
				params,
			};
		case "owner_self_approval":
			return {
				key: "settings.implementationChecklist.goLive.approver.skipOwnerSelfApproval",
				fallback:
					"{kind, select, absence {Absence requests} timeCorrection {Time corrections} workPeriod {Work-period submissions} periodSubmission {Period submissions} expenseReport {Expense reports} other {Shift requests}}: the owner approves their own reports, because nobody else can.",
				params,
			};
	}
}
