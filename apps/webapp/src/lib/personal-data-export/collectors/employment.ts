/**
 * Employment category of a personal data export (#811, #1165).
 *
 * The employee record and profile, employment periods, departures and their
 * history, employment terms with the hourly wage (the employee's own pay,
 * never withheld; the terms are the only wage history, #814), teams, managers, team
 * permissions, locations, skills, project assignments, assigned organization
 * vehicles (#807, archived ones too), custom roles, groups,
 * cost centres, every policy assignment that reaches the employee (holiday
 * presets, single holidays and holiday categories included), and custom field
 * values, and go-live exclusions with their reason (#1513).
 *
 * Assignments that reach the employee through a team or the organization
 * default are exported for the employee's own teams (current and past) and
 * the organization only, with names only: never another team's data.
 *
 * Withheld from the employee export: custom field values above employee
 * visibility, filtered here by kind, departure events about reviews and
 * tasks, also filtered here, and billable and cost rates and departure tasks
 * and reviews, which are admin-export-only parts (`employment-withheld.ts`).
 */

import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { organization, user } from "@/db/auth-schema";
import {
	changePolicy,
	changePolicyAssignment,
	costCenter,
	customFieldDefinition,
	customFieldOption,
	customFieldValue,
	customRole,
	employee,
	employeeAssignedLocation,
	employeeCostCenterAssignment,
	employeeCustomRole,
	employeeDeparture,
	employeeDepartureEvent,
	employeeEmploymentHistory,
	employeeEmploymentPeriod,
	employeeGroup,
	employeeGroupMember,
	employeeManagers,
	employeeSkill,
	employeeTeamHistory,
	goLiveExclusion,
	holiday,
	holidayAssignment,
	holidayCategory,
	holidayCategoryAssignment,
	holidayPreset,
	holidayPresetAssignment,
	location,
	locationEmployee,
	locationSubarea,
	organizationVehicle,
	organizationVehicleDriver,
	positionCaptureAssignment,
	project,
	projectAssignment,
	projectAssignmentHistory,
	projectManager,
	skill,
	subareaEmployee,
	surchargeModel,
	surchargeModelAssignment,
	team,
	teamMembership,
	teamPermissions,
	vacationAllowance,
	vacationPolicyAssignment,
	workCategorySet,
	workCategorySetAssignment,
	workPolicy,
	workPolicyAssignment,
} from "@/db/schema";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataRow,
	recordPart,
	tablePart,
} from "../collector";
import {
	employeeNameLookup,
	instantText,
	PersonalDataSubjectNotFoundError,
	plainDateText,
	userNameLookup,
} from "../values";
import { employmentFieldGuide } from "./employment-fields";
import { collectWithheldEmploymentParts } from "./employment-withheld";

/** The subject employee's own profile columns (the `employee` row of this organization). */
const person = employee;

/** Custom field visibilities included per export kind. */
function customFieldVisibilities(kind: PersonalDataExportScope["kind"]): string[] {
	return kind === "admin" ? ["employee", "manager", "admin"] : ["employee"];
}

/** Departure events about departure reviews and tasks: admin export only, like the reviews and tasks. */
const WITHHELD_DEPARTURE_EVENT_KINDS: ReadonlySet<string> = new Set([
	"review_resolved",
	"task_failed",
]);

const POLICY_COLUMNS = [
	"policy_kind",
	"policy",
	"assignment_type",
	"team",
	"priority",
	"effective_from",
	"effective_until",
	"is_active",
	"capture_enabled",
	"assigned_at",
	"assigned_by",
] as const;

export const employmentCollector: PersonalDataCollector = {
	category: "employment",
	collect: collectEmployment,
	fields: employmentFieldGuide,
};

async function collectEmployment(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const { organizationId, employeeId } = scope;
	const [subject] = await database
		.select({
			id: person.id,
			userId: person.userId,
			teamId: person.teamId,
			firstName: person.firstName,
			lastName: person.lastName,
			gender: person.gender,
			pronouns: person.pronouns,
			birthday: person.birthday,
			role: person.role,
			employeeNumber: person.employeeNumber,
			position: person.position,
			startDate: person.startDate,
			endDate: person.endDate,
			isActive: person.isActive,
			contractType: person.contractType,
			createdAt: person.createdAt,
			updatedAt: person.updatedAt,
			userName: user.name,
			userFirstName: user.firstName,
			userLastName: user.lastName,
			email: user.email,
			organizationName: organization.name,
		})
		.from(person)
		.innerJoin(user, eq(user.id, person.userId))
		.innerJoin(organization, eq(organization.id, person.organizationId))
		.where(and(eq(person.id, employeeId), eq(person.organizationId, organizationId)))
		.limit(1);
	if (!subject) throw new PersonalDataSubjectNotFoundError();

	// The employee's teams: primary, memberships and every team they were in.
	const [memberships, teamHistory] = await Promise.all([
		database
			.select({
				teamId: teamMembership.teamId,
				createdAt: teamMembership.createdAt,
				createdBy: teamMembership.createdBy,
			})
			.from(teamMembership)
			.where(
				and(
					eq(teamMembership.organizationId, organizationId),
					eq(teamMembership.employeeId, employeeId),
				),
			)
			.orderBy(asc(teamMembership.createdAt)),
		database
			.select({
				teamId: employeeTeamHistory.teamId,
				effectiveFrom: employeeTeamHistory.effectiveFrom,
				effectiveTo: employeeTeamHistory.effectiveTo,
			})
			.from(employeeTeamHistory)
			.where(
				and(
					eq(employeeTeamHistory.organizationId, organizationId),
					eq(employeeTeamHistory.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeTeamHistory.effectiveFrom)),
	]);
	const ownTeamIds = [
		...new Set(
			[
				subject.teamId,
				...memberships.map((row) => row.teamId),
				...teamHistory.map((row) => row.teamId),
			].filter((id): id is string => Boolean(id)),
		),
	];
	const teamRows =
		ownTeamIds.length === 0
			? []
			: await database
					.select({ id: team.id, name: team.name })
					.from(team)
					.where(and(eq(team.organizationId, organizationId), inArray(team.id, ownTeamIds)));
	const teamNames = new Map(teamRows.map((row) => [row.id, row.name]));
	const teamName = (id: string | null | undefined) => (id ? (teamNames.get(id) ?? null) : null);

	/** Rows of an assignment table that reach the employee: own, own teams', organization's. */
	const reachesEmployee = (columns: AssignmentTargetColumns) =>
		and(
			eq(columns.organizationId, organizationId),
			or(
				and(eq(columns.assignmentType, "employee"), eq(columns.employeeId, employeeId)),
				ownTeamIds.length > 0
					? and(eq(columns.assignmentType, "team"), inArray(columns.teamId, ownTeamIds))
					: undefined,
				eq(columns.assignmentType, "organization"),
			),
		);

	const [
		periods,
		departures,
		terms,
		managers,
		permissions,
		assignedLocations,
		supervisedLocations,
		supervisedSubareas,
		skills,
		projectRows,
		projectHistoryRows,
		managedProjects,
		roles,
		groups,
		costCenters,
		policyRows,
		customFields,
		assignedVehicles,
	] = await Promise.all([
		database
			.select()
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, organizationId),
					eq(employeeEmploymentPeriod.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeEmploymentPeriod.startedAt)),
		database
			.select()
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, organizationId),
					eq(employeeDeparture.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeDeparture.createdAt)),
		database
			.select({
				terms: employeeEmploymentHistory,
				workPolicyName: workPolicy.name,
			})
			.from(employeeEmploymentHistory)
			.leftJoin(
				workPolicy,
				and(
					eq(workPolicy.id, employeeEmploymentHistory.workPolicyId),
					eq(workPolicy.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(employeeEmploymentHistory.organizationId, organizationId),
					eq(employeeEmploymentHistory.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeEmploymentHistory.validFrom)),
		// `employee_managers` has no organization: the manager must be of this one.
		database
			.select({
				managerId: employeeManagers.managerId,
				isPrimary: employeeManagers.isPrimary,
				assignedAt: employeeManagers.assignedAt,
				assignedBy: employeeManagers.assignedBy,
			})
			.from(employeeManagers)
			.innerJoin(employee, eq(employee.id, employeeManagers.managerId))
			.where(
				and(
					eq(employeeManagers.employeeId, employeeId),
					eq(employee.organizationId, organizationId),
				),
			)
			.orderBy(asc(employeeManagers.assignedAt)),
		database
			.select()
			.from(teamPermissions)
			.where(
				and(
					eq(teamPermissions.organizationId, organizationId),
					eq(teamPermissions.employeeId, employeeId),
				),
			)
			.orderBy(asc(teamPermissions.grantedAt)),
		database
			.select({
				name: location.name,
				street: location.street,
				city: location.city,
				postalCode: location.postalCode,
				country: location.country,
				createdAt: employeeAssignedLocation.createdAt,
				createdBy: employeeAssignedLocation.createdBy,
			})
			.from(employeeAssignedLocation)
			.innerJoin(
				location,
				and(
					eq(location.id, employeeAssignedLocation.locationId),
					eq(location.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(employeeAssignedLocation.organizationId, organizationId),
					eq(employeeAssignedLocation.employeeId, employeeId),
				),
			)
			.orderBy(asc(location.name)),
		database
			.select({
				location: location.name,
				isPrimary: locationEmployee.isPrimary,
				createdAt: locationEmployee.createdAt,
				createdBy: locationEmployee.createdBy,
			})
			.from(locationEmployee)
			.innerJoin(
				location,
				and(
					eq(location.id, locationEmployee.locationId),
					eq(location.organizationId, organizationId),
				),
			)
			.where(eq(locationEmployee.employeeId, employeeId))
			.orderBy(asc(location.name)),
		database
			.select({
				location: location.name,
				subarea: locationSubarea.name,
				isPrimary: subareaEmployee.isPrimary,
				createdAt: subareaEmployee.createdAt,
				createdBy: subareaEmployee.createdBy,
			})
			.from(subareaEmployee)
			.innerJoin(locationSubarea, eq(locationSubarea.id, subareaEmployee.subareaId))
			.innerJoin(
				location,
				and(
					eq(location.id, locationSubarea.locationId),
					eq(location.organizationId, organizationId),
				),
			)
			.where(eq(subareaEmployee.employeeId, employeeId))
			.orderBy(asc(location.name), asc(locationSubarea.name)),
		// `employee_skill` has no organization, and legacy rows may point at another one's skills.
		database
			.select({
				name: skill.name,
				category: skill.category,
				customCategoryName: skill.customCategoryName,
				expiresAt: employeeSkill.expiresAt,
				notes: employeeSkill.notes,
				assignedAt: employeeSkill.assignedAt,
				assignedBy: employeeSkill.assignedBy,
			})
			.from(employeeSkill)
			.innerJoin(
				skill,
				and(eq(skill.id, employeeSkill.skillId), eq(skill.organizationId, organizationId)),
			)
			.where(eq(employeeSkill.employeeId, employeeId))
			.orderBy(asc(skill.name)),
		database
			.select({
				project: project.name,
				assignmentType: projectAssignment.assignmentType,
				teamId: projectAssignment.teamId,
				createdAt: projectAssignment.createdAt,
				createdBy: projectAssignment.createdBy,
			})
			.from(projectAssignment)
			.innerJoin(
				project,
				and(
					eq(project.id, projectAssignment.projectId),
					eq(project.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(projectAssignment.organizationId, organizationId),
					or(
						and(
							eq(projectAssignment.assignmentType, "employee"),
							eq(projectAssignment.employeeId, employeeId),
						),
						ownTeamIds.length > 0
							? and(
									eq(projectAssignment.assignmentType, "team"),
									inArray(projectAssignment.teamId, ownTeamIds),
								)
							: undefined,
					),
				),
			)
			.orderBy(asc(project.name)),
		database
			.select({
				project: project.name,
				assignmentType: projectAssignmentHistory.assignmentType,
				teamId: projectAssignmentHistory.teamId,
				effectiveFrom: projectAssignmentHistory.effectiveFrom,
				effectiveTo: projectAssignmentHistory.effectiveTo,
				createdBy: projectAssignmentHistory.createdBy,
			})
			.from(projectAssignmentHistory)
			.innerJoin(
				project,
				and(
					eq(project.id, projectAssignmentHistory.projectId),
					eq(project.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(projectAssignmentHistory.organizationId, organizationId),
					or(
						and(
							eq(projectAssignmentHistory.assignmentType, "employee"),
							eq(projectAssignmentHistory.employeeId, employeeId),
						),
						ownTeamIds.length > 0
							? and(
									eq(projectAssignmentHistory.assignmentType, "team"),
									inArray(projectAssignmentHistory.teamId, ownTeamIds),
								)
							: undefined,
					),
				),
			)
			.orderBy(asc(projectAssignmentHistory.effectiveFrom)),
		database
			.select({
				project: project.name,
				assignedAt: projectManager.assignedAt,
				assignedBy: projectManager.assignedBy,
			})
			.from(projectManager)
			.innerJoin(
				project,
				and(eq(project.id, projectManager.projectId), eq(project.organizationId, organizationId)),
			)
			.where(eq(projectManager.employeeId, employeeId))
			.orderBy(asc(project.name)),
		database
			.select({
				name: customRole.name,
				description: customRole.description,
				assignedAt: employeeCustomRole.assignedAt,
				assignedBy: employeeCustomRole.assignedBy,
			})
			.from(employeeCustomRole)
			.innerJoin(
				customRole,
				and(
					eq(customRole.id, employeeCustomRole.customRoleId),
					eq(customRole.organizationId, organizationId),
				),
			)
			.where(eq(employeeCustomRole.employeeId, employeeId))
			.orderBy(asc(customRole.name)),
		database
			.select({
				name: employeeGroup.name,
				description: employeeGroup.description,
				createdAt: employeeGroupMember.createdAt,
				createdBy: employeeGroupMember.createdBy,
			})
			.from(employeeGroupMember)
			.innerJoin(
				employeeGroup,
				and(
					eq(employeeGroup.id, employeeGroupMember.groupId),
					eq(employeeGroup.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(employeeGroupMember.organizationId, organizationId),
					eq(employeeGroupMember.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeGroup.name)),
		database
			.select({
				name: costCenter.name,
				code: costCenter.code,
				effectiveFrom: employeeCostCenterAssignment.effectiveFrom,
				effectiveTo: employeeCostCenterAssignment.effectiveTo,
			})
			.from(employeeCostCenterAssignment)
			.innerJoin(
				costCenter,
				and(
					eq(costCenter.id, employeeCostCenterAssignment.costCenterId),
					eq(costCenter.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(employeeCostCenterAssignment.organizationId, organizationId),
					eq(employeeCostCenterAssignment.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeCostCenterAssignment.effectiveFrom)),
		collectPolicyAssignments(database, organizationId, reachesEmployee),
		database
			.select({
				field: customFieldDefinition.name,
				type: customFieldDefinition.type,
				visibility: customFieldDefinition.visibility,
				archivedAt: customFieldDefinition.archivedAt,
				textValue: customFieldValue.textValue,
				numberValue: customFieldValue.numberValue,
				dateValue: customFieldValue.dateValue,
				booleanValue: customFieldValue.booleanValue,
				optionLabel: customFieldOption.label,
				validFrom: customFieldValue.validFrom,
				tracked: customFieldValue.tracked,
				updatedAt: customFieldValue.updatedAt,
				updatedBy: customFieldValue.updatedBy,
			})
			.from(customFieldValue)
			.innerJoin(
				customFieldDefinition,
				and(
					eq(customFieldDefinition.id, customFieldValue.definitionId),
					eq(customFieldDefinition.organizationId, organizationId),
				),
			)
			.leftJoin(
				customFieldOption,
				and(
					eq(customFieldOption.id, customFieldValue.selectOptionId),
					eq(customFieldOption.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(customFieldValue.organizationId, organizationId),
					eq(customFieldValue.employeeId, employeeId),
					eq(customFieldDefinition.entity, "employee"),
					inArray(customFieldDefinition.visibility, customFieldVisibilities(scope.kind)),
				),
			)
			.orderBy(asc(customFieldDefinition.position), asc(customFieldValue.validFrom)),
		// Assigned drivers (#807): vehicles assigned to the employee or her own teams,
		// archived ones too. A driver row has no assignment type: its target column says it.
		database
			.select({
				vehicle: organizationVehicle.name,
				licencePlate: organizationVehicle.licencePlate,
				archivedAt: organizationVehicle.archivedAt,
				teamId: organizationVehicleDriver.teamId,
				createdAt: organizationVehicleDriver.createdAt,
				createdBy: organizationVehicleDriver.createdBy,
			})
			.from(organizationVehicleDriver)
			.innerJoin(
				organizationVehicle,
				and(
					eq(organizationVehicle.id, organizationVehicleDriver.vehicleId),
					eq(organizationVehicle.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(organizationVehicleDriver.organizationId, organizationId),
					or(
						eq(organizationVehicleDriver.employeeId, employeeId),
						ownTeamIds.length > 0
							? inArray(organizationVehicleDriver.teamId, ownTeamIds)
							: undefined,
					),
				),
			)
			.orderBy(asc(organizationVehicle.name), asc(organizationVehicleDriver.createdAt)),
	]);

	// The departure history, without its technical metadata. Review and task
	// events belong to departure reviews and tasks, which the employee export withholds.
	const departureEvents = (
		await database
			.select({
				departureId: employeeDepartureEvent.departureId,
				kind: employeeDepartureEvent.kind,
				revision: employeeDepartureEvent.revision,
				occurredAt: employeeDepartureEvent.occurredAt,
				actorUserId: employeeDepartureEvent.actorUserId,
			})
			.from(employeeDepartureEvent)
			.where(
				and(
					eq(employeeDepartureEvent.organizationId, organizationId),
					eq(employeeDepartureEvent.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeDepartureEvent.occurredAt), asc(employeeDepartureEvent.eventIndex))
	).filter((row) => scope.kind === "admin" || !WITHHELD_DEPARTURE_EVENT_KINDS.has(row.kind));

	// Go-live exclusions (#1513): the reason is about the employee. Who created or
	// lifted one is left out, so no other person's name is exported.
	const goLiveExclusions = await database
		.select({
			reason: goLiveExclusion.reason,
			createdAt: goLiveExclusion.createdAt,
			liftedAt: goLiveExclusion.liftedAt,
			endedAt: goLiveExclusion.endedAt,
		})
		.from(goLiveExclusion)
		.where(
			and(
				eq(goLiveExclusion.organizationId, organizationId),
				eq(goLiveExclusion.employeeId, employeeId),
			),
		)
		.orderBy(asc(goLiveExclusion.createdAt), asc(goLiveExclusion.id));

	// Team permissions may name any team of the organization, not only the employee's own.
	const permissionTeamIds = permissions
		.map((row) => row.teamId)
		.filter((id): id is string => id !== null && !teamNames.has(id));
	if (permissionTeamIds.length > 0) {
		const permissionTeams = await database
			.select({ id: team.id, name: team.name })
			.from(team)
			.where(and(eq(team.organizationId, organizationId), inArray(team.id, permissionTeamIds)));
		for (const row of permissionTeams) teamNames.set(row.id, row.name);
	}

	const [byUser, byEmployee] = await Promise.all([
		userNameLookup(database, [
			...departureEvents.map((row) => row.actorUserId),
			...memberships.map((row) => row.createdBy),
			...periods.map((row) => row.createdBy),
			...departures.map((row) => row.createdBy),
			...terms.flatMap((row) => [row.terms.createdBy, row.terms.updatedBy]),
			...managers.map((row) => row.assignedBy),
			...assignedLocations.map((row) => row.createdBy),
			...supervisedLocations.map((row) => row.createdBy),
			...supervisedSubareas.map((row) => row.createdBy),
			...skills.map((row) => row.assignedBy),
			...projectRows.map((row) => row.createdBy),
			...projectHistoryRows.map((row) => row.createdBy),
			...managedProjects.map((row) => row.assignedBy),
			...roles.map((row) => row.assignedBy),
			...groups.map((row) => row.createdBy),
			...policyRows.map((row) => row.createdBy),
			...customFields.map((row) => row.updatedBy),
			...assignedVehicles.map((row) => row.createdBy),
		]),
		employeeNameLookup(database, organizationId, [
			...managers.map((row) => row.managerId),
			...permissions.map((row) => row.grantedBy),
			...departures.map((row) => row.replacementEmployeeId),
		]),
	]);

	const employeeRecord: PersonalDataRow = {
		id: subject.id,
		user_id: subject.userId,
		user_name: subject.userName,
		user_first_name: subject.userFirstName,
		user_last_name: subject.userLastName,
		email: subject.email,
		first_name: subject.firstName,
		last_name: subject.lastName,
		gender: subject.gender,
		pronouns: subject.pronouns,
		birthday: plainDateText(subject.birthday),
		organization: subject.organizationName,
		role: subject.role,
		personnel_number: subject.employeeNumber,
		position: subject.position,
		primary_team: teamName(subject.teamId),
		contract_type: subject.contractType,
		start_date: instantText(subject.startDate),
		end_date: instantText(subject.endDate),
		is_active: subject.isActive,
		created_at: instantText(subject.createdAt),
		updated_at: instantText(subject.updatedAt),
	};

	// Withheld data: in the admin export only.
	const withheldParts =
		scope.kind === "admin" ? await collectWithheldEmploymentParts(database, scope) : [];

	return {
		category: "employment",
		parts: [
			recordPart("employee", employeeRecord),
			tablePart(
				"employment_periods",
				["id", "status", "started_at", "ended_at", "start_provenance", "created_at", "created_by"],
				periods.map((row) => ({
					id: row.id,
					status: row.status,
					started_at: instantText(row.startedAt),
					ended_at: instantText(row.endedAt),
					start_provenance: row.startProvenance,
					created_at: instantText(row.createdAt),
					created_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"departures",
				[
					"id",
					"mode",
					"status",
					"last_working_day",
					"timezone",
					"cutoff_at",
					"effective_at",
					"replacement",
					"blocked_reason",
					"created_at",
					"created_by",
				],
				departures.map((row) => ({
					id: row.id,
					mode: row.mode,
					status: row.status,
					last_working_day: row.lastWorkingDay,
					timezone: row.timezone,
					cutoff_at: instantText(row.cutoffAt),
					effective_at: instantText(row.effectiveAt),
					// A colleague named on the record: display name only (#811 decision).
					replacement: byEmployee(row.replacementEmployeeId),
					blocked_reason: row.blockedReason,
					created_at: instantText(row.createdAt),
					created_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"departure_events",
				["departure_id", "kind", "revision", "occurred_at", "actor"],
				departureEvents.map((row) => ({
					departure_id: row.departureId,
					kind: row.kind,
					revision: row.revision,
					occurred_at: instantText(row.occurredAt),
					actor: byUser(row.actorUserId),
				})),
			),
			tablePart(
				"employment_terms",
				[
					"id",
					"valid_from",
					"valid_until",
					"status",
					"contract_type",
					"weekly_contract_minutes",
					"probation_starts_on",
					"probation_ends_on",
					"work_model",
					"work_policy",
					"hourly_rate",
					"currency",
					"change_reason",
					"review_state",
					"created_at",
					"created_by",
					"updated_at",
					"updated_by",
				],
				terms.map(({ terms: row, workPolicyName }) => ({
					id: row.id,
					valid_from: instantText(row.validFrom),
					valid_until: instantText(row.validUntil),
					status: row.status,
					contract_type: row.contractType,
					weekly_contract_minutes: row.weeklyContractMinutes,
					probation_starts_on: plainDateText(row.probationStartsOn),
					probation_ends_on: plainDateText(row.probationEndsOn),
					work_model: row.workModel,
					work_policy: workPolicyName,
					// A number since #814; exported like the other money amounts, with two decimals.
					hourly_rate: row.hourlyRate === null ? null : row.hourlyRate.toFixed(2),
					currency: row.currency,
					change_reason: row.changeReason,
					review_state: row.reviewState,
					created_at: instantText(row.createdAt),
					created_by: byUser(row.createdBy),
					updated_at: instantText(row.updatedAt),
					updated_by: byUser(row.updatedBy),
				})),
			),
			tablePart(
				"teams",
				["team", "primary", "member_since", "added_by"],
				teamsOf(subject.teamId, memberships).map((row) => ({
					team: teamName(row.teamId),
					primary: row.teamId === subject.teamId,
					member_since: instantText(row.createdAt),
					added_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"team_history",
				["team", "effective_from", "effective_to"],
				teamHistory.map((row) => ({
					team: teamName(row.teamId),
					effective_from: instantText(row.effectiveFrom),
					effective_to: instantText(row.effectiveTo),
				})),
			),
			tablePart(
				"managers",
				["manager", "primary", "assigned_at", "assigned_by"],
				managers.map((row) => ({
					manager: byEmployee(row.managerId),
					primary: row.isPrimary,
					assigned_at: instantText(row.assignedAt),
					assigned_by: byUser(row.assignedBy),
				})),
			),
			tablePart(
				"team_permissions",
				[
					"team",
					"can_create_teams",
					"can_manage_team_members",
					"can_manage_team_settings",
					"can_approve_team_requests",
					"granted_at",
					"granted_by",
				],
				permissions.map((row) => ({
					team: teamName(row.teamId),
					can_create_teams: row.canCreateTeams,
					can_manage_team_members: row.canManageTeamMembers,
					can_manage_team_settings: row.canManageTeamSettings,
					can_approve_team_requests: row.canApproveTeamRequests,
					granted_at: instantText(row.grantedAt),
					granted_by: byEmployee(row.grantedBy),
				})),
			),
			tablePart(
				"assigned_locations",
				["location", "street", "city", "postal_code", "country", "assigned_at", "assigned_by"],
				assignedLocations.map((row) => ({
					location: row.name,
					street: row.street,
					city: row.city,
					postal_code: row.postalCode,
					country: row.country,
					assigned_at: instantText(row.createdAt),
					assigned_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"location_supervision",
				["location", "subarea", "primary", "assigned_at", "assigned_by"],
				[
					...supervisedLocations.map((row) => ({ ...row, subarea: null })),
					...supervisedSubareas,
				].map((row) => ({
					location: row.location,
					subarea: row.subarea,
					primary: row.isPrimary,
					assigned_at: instantText(row.createdAt),
					assigned_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"skills",
				["skill", "category", "expires_on", "notes", "assigned_at", "assigned_by"],
				skills.map((row) => ({
					skill: row.name,
					category: row.customCategoryName ?? row.category,
					// Already the plain last valid day (#1142).
					expires_on: row.expiresAt,
					notes: row.notes,
					assigned_at: instantText(row.assignedAt),
					assigned_by: byUser(row.assignedBy),
				})),
			),
			tablePart(
				"project_assignments",
				["project", "assignment_type", "team", "assigned_at", "assigned_by"],
				projectRows.map((row) => ({
					project: row.project,
					assignment_type: row.assignmentType,
					team: teamName(row.teamId),
					assigned_at: instantText(row.createdAt),
					assigned_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"project_assignment_history",
				["project", "assignment_type", "team", "effective_from", "effective_to", "assigned_by"],
				projectHistoryRows.map((row) => ({
					project: row.project,
					assignment_type: row.assignmentType,
					team: teamName(row.teamId),
					effective_from: instantText(row.effectiveFrom),
					effective_to: instantText(row.effectiveTo),
					assigned_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"projects_managed",
				["project", "assigned_at", "assigned_by"],
				managedProjects.map((row) => ({
					project: row.project,
					assigned_at: instantText(row.assignedAt),
					assigned_by: byUser(row.assignedBy),
				})),
			),
			tablePart(
				"assigned_vehicles",
				[
					"vehicle",
					"licence_plate",
					"archived",
					"assignment_type",
					"team",
					"assigned_at",
					"assigned_by",
				],
				assignedVehicles.map((row) => ({
					vehicle: row.vehicle,
					licence_plate: row.licencePlate,
					archived: row.archivedAt !== null,
					assignment_type: row.teamId ? "team" : "employee",
					team: teamName(row.teamId),
					assigned_at: instantText(row.createdAt),
					assigned_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"custom_roles",
				["role", "description", "assigned_at", "assigned_by"],
				roles.map((row) => ({
					role: row.name,
					description: row.description,
					assigned_at: instantText(row.assignedAt),
					assigned_by: byUser(row.assignedBy),
				})),
			),
			tablePart(
				"groups",
				["group", "description", "added_at", "added_by"],
				groups.map((row) => ({
					group: row.name,
					description: row.description,
					added_at: instantText(row.createdAt),
					added_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"cost_centers",
				["cost_center", "code", "effective_from", "effective_to"],
				costCenters.map((row) => ({
					cost_center: row.name,
					code: row.code,
					effective_from: instantText(row.effectiveFrom),
					effective_to: instantText(row.effectiveTo),
				})),
			),
			tablePart(
				"policy_assignments",
				POLICY_COLUMNS,
				policyRows.map((row) => ({
					policy_kind: row.policyKind,
					policy: row.policy,
					assignment_type: row.assignmentType,
					team: teamName(row.teamId),
					priority: row.priority,
					effective_from: instantText(row.effectiveFrom),
					effective_until: instantText(row.effectiveUntil),
					is_active: row.isActive,
					capture_enabled: row.captureEnabled,
					assigned_at: instantText(row.createdAt),
					assigned_by: byUser(row.createdBy),
				})),
			),
			tablePart(
				"custom_fields",
				[
					"field",
					"type",
					"value",
					"valid_from",
					"tracked",
					"field_archived",
					"updated_at",
					"updated_by",
				],
				customFields.map((row) => ({
					field: row.field,
					type: row.type,
					value:
						row.textValue ??
						row.numberValue ??
						row.dateValue ??
						row.optionLabel ??
						(row.booleanValue === null ? null : row.booleanValue),
					valid_from: row.validFrom,
					tracked: row.tracked,
					field_archived: row.archivedAt !== null,
					updated_at: instantText(row.updatedAt),
					updated_by: byUser(row.updatedBy),
				})),
			),
			tablePart(
				"go_live_exclusions",
				["reason", "created_at", "lifted_at", "ended_at"],
				goLiveExclusions.map((row) => ({
					reason: row.reason,
					created_at: instantText(row.createdAt),
					lifted_at: instantText(row.liftedAt),
					ended_at: instantText(row.endedAt),
				})),
			),
			...withheldParts,
		],
	};
}

/** Team memberships plus a primary team that has no membership row. */
function teamsOf(
	primaryTeamId: string | null,
	memberships: { teamId: string; createdAt: Date; createdBy: string | null }[],
): { teamId: string; createdAt: Date | null; createdBy: string | null }[] {
	if (!primaryTeamId || memberships.some((row) => row.teamId === primaryTeamId)) {
		return memberships;
	}
	return [{ teamId: primaryTeamId, createdAt: null, createdBy: null }, ...memberships];
}

/** The target columns every policy assignment table shares. */
interface AssignmentTargetColumns {
	organizationId: AnyPgColumn;
	assignmentType: AnyPgColumn;
	employeeId: AnyPgColumn;
	teamId: AnyPgColumn;
}

interface PolicyAssignmentRow {
	policyKind: string;
	policy: string | null;
	assignmentType: string;
	teamId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean | null;
	captureEnabled: boolean | null;
	createdAt: Date;
	createdBy: string;
}

/** Every policy assignment that reaches the employee, with the policy's name only. */
async function collectPolicyAssignments(
	database: PersonalDataExportDatabase,
	organizationId: string,
	reachesEmployee: (columns: AssignmentTargetColumns) => SQL | undefined,
): Promise<PolicyAssignmentRow[]> {
	const [
		work,
		vacation,
		holidayPresets,
		change,
		surcharge,
		workCategory,
		position,
		holidays,
		holidayCategories,
	] = await Promise.all([
		database
			.select({
				policy: workPolicy.name,
				assignmentType: workPolicyAssignment.assignmentType,
				teamId: workPolicyAssignment.teamId,
				priority: workPolicyAssignment.priority,
				effectiveFrom: workPolicyAssignment.effectiveFrom,
				effectiveUntil: workPolicyAssignment.effectiveUntil,
				isActive: workPolicyAssignment.isActive,
				createdAt: workPolicyAssignment.createdAt,
				createdBy: workPolicyAssignment.createdBy,
			})
			.from(workPolicyAssignment)
			.innerJoin(
				workPolicy,
				and(
					eq(workPolicy.id, workPolicyAssignment.policyId),
					eq(workPolicy.organizationId, organizationId),
				),
			)
			.where(reachesEmployee(workPolicyAssignment)),
		database
			.select({
				policy: vacationAllowance.name,
				assignmentType: vacationPolicyAssignment.assignmentType,
				teamId: vacationPolicyAssignment.teamId,
				priority: vacationPolicyAssignment.priority,
				effectiveFrom: vacationPolicyAssignment.effectiveFrom,
				effectiveUntil: vacationPolicyAssignment.effectiveUntil,
				isActive: vacationPolicyAssignment.isActive,
				createdAt: vacationPolicyAssignment.createdAt,
				createdBy: vacationPolicyAssignment.createdBy,
			})
			.from(vacationPolicyAssignment)
			.innerJoin(
				vacationAllowance,
				and(
					eq(vacationAllowance.id, vacationPolicyAssignment.policyId),
					eq(vacationAllowance.organizationId, organizationId),
				),
			)
			.where(reachesEmployee(vacationPolicyAssignment)),
		database
			.select({
				policy: holidayPreset.name,
				assignmentType: holidayPresetAssignment.assignmentType,
				teamId: holidayPresetAssignment.teamId,
				priority: holidayPresetAssignment.priority,
				effectiveFrom: holidayPresetAssignment.effectiveFrom,
				effectiveUntil: holidayPresetAssignment.effectiveUntil,
				isActive: holidayPresetAssignment.isActive,
				createdAt: holidayPresetAssignment.createdAt,
				createdBy: holidayPresetAssignment.createdBy,
			})
			.from(holidayPresetAssignment)
			.innerJoin(
				holidayPreset,
				and(
					eq(holidayPreset.id, holidayPresetAssignment.presetId),
					eq(holidayPreset.organizationId, organizationId),
				),
			)
			.where(reachesEmployee(holidayPresetAssignment)),
		database
			.select({
				policy: changePolicy.name,
				assignmentType: changePolicyAssignment.assignmentType,
				teamId: changePolicyAssignment.teamId,
				priority: changePolicyAssignment.priority,
				effectiveFrom: changePolicyAssignment.effectiveFrom,
				effectiveUntil: changePolicyAssignment.effectiveUntil,
				isActive: changePolicyAssignment.isActive,
				createdAt: changePolicyAssignment.createdAt,
				createdBy: changePolicyAssignment.createdBy,
			})
			.from(changePolicyAssignment)
			.innerJoin(
				changePolicy,
				and(
					eq(changePolicy.id, changePolicyAssignment.policyId),
					eq(changePolicy.organizationId, organizationId),
				),
			)
			.where(reachesEmployee(changePolicyAssignment)),
		database
			.select({
				policy: surchargeModel.name,
				assignmentType: surchargeModelAssignment.assignmentType,
				teamId: surchargeModelAssignment.teamId,
				priority: surchargeModelAssignment.priority,
				effectiveFrom: surchargeModelAssignment.effectiveFrom,
				effectiveUntil: surchargeModelAssignment.effectiveUntil,
				isActive: surchargeModelAssignment.isActive,
				createdAt: surchargeModelAssignment.createdAt,
				createdBy: surchargeModelAssignment.createdBy,
			})
			.from(surchargeModelAssignment)
			.innerJoin(
				surchargeModel,
				and(
					eq(surchargeModel.id, surchargeModelAssignment.modelId),
					eq(surchargeModel.organizationId, organizationId),
				),
			)
			.where(reachesEmployee(surchargeModelAssignment)),
		database
			.select({
				policy: workCategorySet.name,
				assignmentType: workCategorySetAssignment.assignmentType,
				teamId: workCategorySetAssignment.teamId,
				priority: workCategorySetAssignment.priority,
				effectiveFrom: workCategorySetAssignment.effectiveFrom,
				effectiveUntil: workCategorySetAssignment.effectiveUntil,
				isActive: workCategorySetAssignment.isActive,
				createdAt: workCategorySetAssignment.createdAt,
				createdBy: workCategorySetAssignment.createdBy,
			})
			.from(workCategorySetAssignment)
			.innerJoin(
				workCategorySet,
				and(
					eq(workCategorySet.id, workCategorySetAssignment.setId),
					eq(workCategorySet.organizationId, organizationId),
				),
			)
			.where(reachesEmployee(workCategorySetAssignment)),
		database
			.select({
				assignmentType: positionCaptureAssignment.assignmentType,
				teamId: positionCaptureAssignment.teamId,
				priority: positionCaptureAssignment.priority,
				captureEnabled: positionCaptureAssignment.captureEnabled,
				createdAt: positionCaptureAssignment.createdAt,
				createdBy: positionCaptureAssignment.createdBy,
			})
			.from(positionCaptureAssignment)
			.where(reachesEmployee(positionCaptureAssignment)),
		// Single holidays and holiday categories assigned outside a preset.
		database
			.select({
				policy: holiday.name,
				assignmentType: holidayAssignment.assignmentType,
				teamId: holidayAssignment.teamId,
				isActive: holidayAssignment.isActive,
				createdAt: holidayAssignment.createdAt,
				createdBy: holidayAssignment.createdBy,
			})
			.from(holidayAssignment)
			.innerJoin(
				holiday,
				and(
					eq(holiday.id, holidayAssignment.holidayId),
					eq(holiday.organizationId, organizationId),
				),
			)
			.where(reachesEmployee(holidayAssignment)),
		database
			.select({
				policy: holidayCategory.name,
				assignmentType: holidayCategoryAssignment.assignmentType,
				teamId: holidayCategoryAssignment.teamId,
				isActive: holidayCategoryAssignment.isActive,
				createdAt: holidayCategoryAssignment.createdAt,
				createdBy: holidayCategoryAssignment.createdBy,
			})
			.from(holidayCategoryAssignment)
			.innerJoin(
				holidayCategory,
				and(
					eq(holidayCategory.id, holidayCategoryAssignment.categoryId),
					eq(holidayCategory.organizationId, organizationId),
				),
			)
			.where(reachesEmployee(holidayCategoryAssignment)),
	]);

	const timed = (policyKind: string, rows: (typeof work)[number][]): PolicyAssignmentRow[] =>
		rows.map((row) => ({ ...row, policyKind, captureEnabled: null }));
	const untimed = (policyKind: string, rows: (typeof holidays)[number][]): PolicyAssignmentRow[] =>
		rows.map((row) => ({
			...row,
			policyKind,
			priority: 0,
			effectiveFrom: null,
			effectiveUntil: null,
			captureEnabled: null,
		}));
	return [
		...timed("work", work),
		...timed("vacation", vacation),
		...timed("holiday", holidayPresets),
		...untimed("holiday_assignment", holidays),
		...untimed("holiday_category", holidayCategories),
		...timed("change", change),
		...timed("surcharge", surcharge),
		...timed("work_category_set", workCategory),
		...position.map((row) => ({
			...row,
			policyKind: "position_capture",
			policy: null,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: null,
		})),
	].sort(
		(left, right) =>
			left.policyKind.localeCompare(right.policyKind) ||
			left.priority - right.priority ||
			left.createdAt.getTime() - right.createdAt.getTime() ||
			(left.policy ?? "").localeCompare(right.policy ?? ""),
	);
}
