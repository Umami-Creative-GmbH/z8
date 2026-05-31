export interface ApprovalInboxSessionLike {
	user: { id: string };
	session?: { activeOrganizationId?: string | null } | null;
}

export interface ApprovalInboxAbilityLike {
	cannot: (action: string, subject: string) => boolean;
}

export interface ApprovalInboxEmployeeContext {
	id: string;
	organizationId: string;
}

export interface ApprovalInboxEligibleScope {
	requesterEmployeeId: string;
	eligibleApproverIds: string[];
}

export interface ApprovalInboxActorContext {
	userId: string;
	activeOrganizationId: string;
	employee: ApprovalInboxEmployeeContext;
	includeAllApprovers: boolean;
	eligibleApprovalScopes: ApprovalInboxEligibleScope[];
}

export class ApprovalInboxForbiddenError extends Error {
	constructor(message = "Forbidden") {
		super(message);
		this.name = "ApprovalInboxForbiddenError";
	}
}

export class ApprovalInboxUnauthorizedError extends Error {
	constructor(message = "Unauthorized") {
		super(message);
		this.name = "ApprovalInboxUnauthorizedError";
	}
}

export class ApprovalInboxBadRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ApprovalInboxBadRequestError";
	}
}

export async function createApprovalInboxActorContext({
	session,
	ability,
	findCurrentEmployee,
	loadEligibleApprovalScopes,
}: {
	session: ApprovalInboxSessionLike | null;
	ability: ApprovalInboxAbilityLike | null;
	findCurrentEmployee: (userId: string, organizationId: string) => Promise<ApprovalInboxEmployeeContext | null>;
	loadEligibleApprovalScopes: (input: {
		managerEmployeeId: string;
		organizationId: string;
	}) => Promise<ApprovalInboxEligibleScope[]>;
}): Promise<ApprovalInboxActorContext> {
	if (!session?.user) throw new ApprovalInboxUnauthorizedError();

	const activeOrganizationId = session.session?.activeOrganizationId;
	if (!activeOrganizationId) throw new ApprovalInboxBadRequestError("No active organization");
	if (!ability) throw new ApprovalInboxForbiddenError();

	const canManageApprovals = ability.cannot("manage", "Approval") === false;
	const canApproveApprovals = ability.cannot("approve", "Approval") === false;
	if (!canApproveApprovals && !canManageApprovals) throw new ApprovalInboxForbiddenError();

	const employee = await findCurrentEmployee(session.user.id, activeOrganizationId);
	if (!employee) throw new ApprovalInboxBadRequestError("Employee not found");
	if (employee.organizationId !== activeOrganizationId) {
		throw new ApprovalInboxBadRequestError("Employee organization mismatch");
	}

	return {
		userId: session.user.id,
		activeOrganizationId,
		employee,
		includeAllApprovers: canManageApprovals,
		eligibleApprovalScopes: canManageApprovals
			? []
			: await loadEligibleApprovalScopes({
					managerEmployeeId: employee.id,
					organizationId: employee.organizationId,
				}),
	};
}
