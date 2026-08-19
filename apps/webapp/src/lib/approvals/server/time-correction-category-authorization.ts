import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { db } from "@/db";
import {
	team,
	teamMembership,
	workCategory,
	workCategorySet,
	workCategorySetAssignment,
	workCategorySetCategory,
} from "@/db/schema";
import { compareInstants, systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { instantFromTimeCorrectionBoundary } from "@/lib/time-tracking/time-correction-temporal";

type CategoryAuthorizationDb = Pick<typeof db, "select">;

function categoryAuthorizationDenied(): ValidationError {
	return new ValidationError({
		message: "Cannot assign to this work category",
		field: "workCategoryId",
	});
}

export async function lockTrustedTimeCorrectionEmployeeTeamId(input: {
	tx: CategoryAuthorizationDb;
	employeeId: string;
	employeeTeamId: string | null;
	organizationId: string;
}): Promise<string | null> {
	const lockedMemberships = await input.tx
		.select()
		.from(teamMembership)
		.where(
			and(
				eq(teamMembership.employeeId, input.employeeId),
				eq(teamMembership.organizationId, input.organizationId),
			),
		)
		.orderBy(asc(teamMembership.id))
		.for("update");
	const membershipTeamIds = lockedMemberships.map(
		(membership) => membership.teamId,
	);
	const lockedTeams = membershipTeamIds.length
		? await input.tx
				.select()
				.from(team)
				.where(
					and(
						eq(team.organizationId, input.organizationId),
						inArray(team.id, membershipTeamIds),
					),
				)
				.orderBy(asc(team.id))
				.for("update")
		: [];

	return input.employeeTeamId &&
		lockedMemberships.some(
			(membership) =>
				membership.employeeId === input.employeeId &&
				membership.organizationId === input.organizationId &&
				membership.teamId === input.employeeTeamId,
		) &&
		lockedTeams.some(
			(currentTeam) =>
				currentTeam.id === input.employeeTeamId &&
				currentTeam.organizationId === input.organizationId,
		)
		? input.employeeTeamId
		: null;
}

export async function authorizeTimeCorrectionCategoryChange(input: {
	tx: CategoryAuthorizationDb;
	employeeId: string;
	teamId: string | null;
	organizationId: string;
	proposedWorkCategoryId: string | null;
	currentWorkCategoryId: string | null;
}): Promise<void> {
	if (
		input.proposedWorkCategoryId === null ||
		input.proposedWorkCategoryId === input.currentWorkCategoryId
	) {
		return;
	}

	const categories = await input.tx
		.select()
		.from(workCategory)
		.where(
			and(
				eq(workCategory.id, input.proposedWorkCategoryId),
				eq(workCategory.organizationId, input.organizationId),
			),
		)
		.orderBy(asc(workCategory.id))
		.for("update");
	const category = categories[0];
	if (
		categories.length !== 1 ||
		!category ||
		category.id !== input.proposedWorkCategoryId ||
		category.organizationId !== input.organizationId ||
		!category.isActive
	) {
		throw categoryAuthorizationDenied();
	}

	const assignments = await input.tx
		.select()
		.from(workCategorySetAssignment)
		.where(
			and(
				eq(workCategorySetAssignment.organizationId, input.organizationId),
				or(
					and(
						eq(workCategorySetAssignment.assignmentType, "employee"),
						eq(workCategorySetAssignment.employeeId, input.employeeId),
					),
					input.teamId
						? and(
								eq(workCategorySetAssignment.assignmentType, "team"),
								eq(workCategorySetAssignment.teamId, input.teamId),
							)
						: undefined,
					eq(workCategorySetAssignment.assignmentType, "organization"),
				),
			),
		)
		.orderBy(asc(workCategorySetAssignment.id))
		.for("update");
	const assignmentSetIds = [...new Set(assignments.map((item) => item.setId))];
	const sets = assignmentSetIds.length
		? await input.tx
				.select()
				.from(workCategorySet)
				.where(
					and(
						eq(workCategorySet.organizationId, input.organizationId),
						inArray(workCategorySet.id, assignmentSetIds),
					),
				)
				.orderBy(asc(workCategorySet.id))
				.for("update")
		: [];
	const setsById = new Map(sets.map((set) => [set.id, set]));
	const now = systemClock.nowInstant();
	const isEffective = (assignment: (typeof assignments)[number]) =>
		assignment.organizationId === input.organizationId &&
		assignment.isActive &&
		setsById.get(assignment.setId)?.organizationId === input.organizationId &&
		setsById.get(assignment.setId)?.isActive === true &&
		(!assignment.effectiveFrom ||
			compareInstants(
				instantFromTimeCorrectionBoundary(assignment.effectiveFrom),
				now,
			) <= 0) &&
		(!assignment.effectiveUntil ||
			compareInstants(
				instantFromTimeCorrectionBoundary(assignment.effectiveUntil),
				now,
			) >= 0);
	const assignment =
		assignments.find(
			(item) =>
				item.assignmentType === "employee" &&
				item.employeeId === input.employeeId &&
				isEffective(item),
		) ??
		(input.teamId
			? assignments.find(
					(item) =>
						item.assignmentType === "team" &&
						item.teamId === input.teamId &&
						isEffective(item),
				)
			: undefined) ??
		assignments.find(
			(item) => item.assignmentType === "organization" && isEffective(item),
		);
	const categorySetRows = assignment
		? await input.tx
				.select()
				.from(workCategorySetCategory)
				.where(
					and(
						eq(workCategorySetCategory.setId, assignment.setId),
						eq(
							workCategorySetCategory.categoryId,
							input.proposedWorkCategoryId,
						),
					),
				)
				.orderBy(asc(workCategorySetCategory.id))
				.for("update")
		: [];
	if (categorySetRows.length !== 1) {
		throw categoryAuthorizationDenied();
	}
}
