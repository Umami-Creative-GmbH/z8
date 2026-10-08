/**
 * Officer scope (#747, ADR 0002): which approved expense reports and legacy
 * claims someone handles after approval. Owners and admins handle all of them; an
 * expense officer handles those of the employees named in their grant and
 * those recorded at approval with one of the grant's teams. The teams are the
 * report's own record (`approval-teams.ts`), never the employee's current ones.
 */

export type OfficerScope =
	| { kind: "all" }
	| { kind: "specific"; teamIds: readonly string[]; employeeIds: readonly string[] };

export const ALL_OFFICER_SCOPE: OfficerScope = { kind: "all" };

/** What scope decides on: the report's employee and the teams recorded at its approval. */
export interface OfficerScopeSubject {
	employeeId: string;
	approvalTeamIds: readonly string[];
}

export function isInOfficerScope(
	scope: OfficerScope | null,
	subject: OfficerScopeSubject,
): boolean {
	if (!scope) return false;
	if (scope.kind === "all") return true;
	return (
		scope.employeeIds.includes(subject.employeeId) ||
		subject.approvalTeamIds.some((teamId) => scope.teamIds.includes(teamId))
	);
}

/** An active expense officer who can record reimbursements (#756). */
export interface ReimbursingOfficer {
	officerEmployeeId: string;
	userId: string;
	scope: OfficerScope;
}

/**
 * The officers who can reimburse a report or claim: those whose scope covers
 * it, never its own employee, who records no money for their own expenses.
 */
export function coveringOfficers<T extends ReimbursingOfficer>(
	officers: readonly T[],
	subject: OfficerScopeSubject,
): T[] {
	return officers.filter(
		(officer) =>
			officer.officerEmployeeId !== subject.employeeId && isInOfficerScope(officer.scope, subject),
	);
}

/** The reports covered by either scope. */
export function mergeOfficerScopes(
	left: OfficerScope | null,
	right: OfficerScope | null,
): OfficerScope | null {
	if (!left) return right;
	if (!right) return left;
	if (left.kind === "all" || right.kind === "all") return ALL_OFFICER_SCOPE;
	return {
		kind: "specific",
		teamIds: [...new Set([...left.teamIds, ...right.teamIds])].toSorted(),
		employeeIds: [...new Set([...left.employeeIds, ...right.employeeIds])].toSorted(),
	};
}

/** Where an owner, admin or expense officer may do each thing; null where they may not. */
export interface FinanceScopes {
	/** The finance queue, approved evidence (frozen revisions, receipts) and balances. */
	read: OfficerScope | null;
	/** Recording reimbursements and recoveries. */
	settle: OfficerScope | null;
	/** Creating, listing and downloading export batches. */
	export: OfficerScope | null;
}

export interface ExpenseOfficerGrantAccess {
	scope: OfficerScope;
	canExport: boolean;
	canRecordReimbursements: boolean;
}

/**
 * Combines organization-wide finance access (owners and admins) with the
 * user's active expense officer grant, one capability
 * at a time: a grant never widens what organization-wide access allows, and
 * organization-wide reading never widens a grant's capabilities. A grant always
 * includes reading; exporting always needs reading, since a batch holds receipts.
 */
export function resolveFinanceScopes(input: {
	organizationWide: { read: boolean; settle: boolean; export: boolean };
	grant: ExpenseOfficerGrantAccess | null;
}): FinanceScopes {
	const { organizationWide, grant } = input;
	const read = mergeOfficerScopes(
		organizationWide.read ? ALL_OFFICER_SCOPE : null,
		grant?.scope ?? null,
	);
	const settle = mergeOfficerScopes(
		organizationWide.settle ? ALL_OFFICER_SCOPE : null,
		grant?.canRecordReimbursements ? grant.scope : null,
	);
	const exportScope = mergeOfficerScopes(
		organizationWide.export && organizationWide.read ? ALL_OFFICER_SCOPE : null,
		grant?.canExport ? grant.scope : null,
	);
	return { read, settle, export: exportScope };
}
