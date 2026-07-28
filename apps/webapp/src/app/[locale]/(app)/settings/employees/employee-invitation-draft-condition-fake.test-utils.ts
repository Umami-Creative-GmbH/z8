import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

export type InvitationDraftEligibilityModel = {
	draft: {
		id: string;
		invitationId: string;
		organizationId: string;
		normalizedEmail: string;
	};
	invitation: {
		id: string;
		organizationId: string;
		status: string;
		expiresAt: Date;
	};
	employees: Array<{
		organizationId: string;
		userEmail: string;
	}>;
};

function parameterFor(
	sql: string,
	params: unknown[],
	column: string,
	operator: "=" | ">",
) {
	const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = sql.match(
		new RegExp(`${escapedColumn} \\${operator} \\$(\\d+)`),
	);
	return match ? params[Number(match[1]) - 1] : undefined;
}

export function predicateMatchesInvitationDraftModel(
	predicate: unknown,
	model: InvitationDraftEligibilityModel,
) {
	const query = new PgDialect().sqlToQuery(predicate as SQL);
	const normalizedSql = query.sql.replace(/\s+/g, " ");

	if (
		normalizedSql.includes(
			'"employee_invitation_draft"."invitation_id" = "invitation"."id"',
		) &&
		model.draft.invitationId !== model.invitation.id
	) {
		return false;
	}

	const draftOrganizationId = parameterFor(
		normalizedSql,
		query.params,
		'"employee_invitation_draft"."organization_id"',
		"=",
	);
	if (
		draftOrganizationId !== undefined &&
		model.draft.organizationId !== draftOrganizationId
	) {
		return false;
	}

	const invitationOrganizationId = parameterFor(
		normalizedSql,
		query.params,
		'"invitation"."organization_id"',
		"=",
	);
	if (
		invitationOrganizationId !== undefined &&
		model.invitation.organizationId !== invitationOrganizationId
	) {
		return false;
	}

	const invitationStatus = parameterFor(
		normalizedSql,
		query.params,
		'"invitation"."status"',
		"=",
	);
	if (
		invitationStatus !== undefined &&
		model.invitation.status !== invitationStatus
	) {
		return false;
	}

	const expiresAfter = parameterFor(
		normalizedSql,
		query.params,
		'"invitation"."expires_at"',
		">",
	);
	if (
		typeof expiresAfter === "string" &&
		model.invitation.expiresAt.getTime() <= new Date(expiresAfter).getTime()
	) {
		return false;
	}

	const draftId = parameterFor(
		normalizedSql,
		query.params,
		'"employee_invitation_draft"."id"',
		"=",
	);
	if (draftId !== undefined && model.draft.id !== draftId) {
		return false;
	}

	if (normalizedSql.includes("not exists")) {
		const employeeOrganizationId = parameterFor(
			normalizedSql,
			query.params,
			'"employee"."organization_id"',
			"=",
		);
		const hasMatchingEmployee = model.employees.some(
			(candidate) =>
				candidate.organizationId === employeeOrganizationId &&
				candidate.userEmail.trim().toLowerCase() ===
					model.draft.normalizedEmail,
		);
		if (hasMatchingEmployee) return false;
	}

	return true;
}
