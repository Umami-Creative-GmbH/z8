/**
 * The README's explanation of every part and field of the Employment
 * category (#811, #1172), withheld parts included: the README shows only the
 * parts in the archive, so an employee export never mentions them. See
 * "Field guide" in `../collector.ts`.
 */

import { commonFieldExplanations, type PersonalDataFieldGuide } from "../collector";

export const employmentFieldGuide: PersonalDataFieldGuide = (t) => {
	const common = (...names: Parameters<typeof commonFieldExplanations>[1]) =>
		commonFieldExplanations(t, names);
	const team = () =>
		t("personalDataExport.readme.fields.employment.shared.team", "The team's name.");
	const project = () =>
		t("personalDataExport.readme.fields.employment.shared.project", "The project's name.");
	const assignmentType = () =>
		t(
			"personalDataExport.readme.fields.employment.shared.assignmentType",
			"How it reaches you: assigned to you (employee), to your team (team) or to the whole organization (organization).",
		);
	const primary = () =>
		t(
			"personalDataExport.readme.fields.employment.shared.primary",
			"Whether it is your primary one.",
		);

	return {
		employee: {
			summary: t(
				"personalDataExport.readme.fields.employment.employee.summary",
				"Your employee record in this organization and your user account's name.",
			),
			fields: {
				...common("id", "created_at", "updated_at"),
				user_id: t(
					"personalDataExport.readme.fields.employment.employee.userId",
					"The ID of your user account.",
				),
				user_name: t(
					"personalDataExport.readme.fields.employment.employee.userName",
					"The name of your user account.",
				),
				user_first_name: t(
					"personalDataExport.readme.fields.employment.employee.userFirstName",
					"The first name of your user account.",
				),
				user_last_name: t(
					"personalDataExport.readme.fields.employment.employee.userLastName",
					"The last name of your user account.",
				),
				email: t(
					"personalDataExport.readme.fields.employment.employee.email",
					"The email address of your user account.",
				),
				first_name: t(
					"personalDataExport.readme.fields.employment.employee.firstName",
					"Your first name in your employee record.",
				),
				last_name: t(
					"personalDataExport.readme.fields.employment.employee.lastName",
					"Your last name in your employee record.",
				),
				gender: t("personalDataExport.readme.fields.employment.employee.gender", "Your gender."),
				pronouns: t(
					"personalDataExport.readme.fields.employment.employee.pronouns",
					"Your pronouns.",
				),
				birthday: t(
					"personalDataExport.readme.fields.employment.employee.birthday",
					"Your birthday (YYYY-MM-DD).",
				),
				organization: t(
					"personalDataExport.readme.fields.employment.employee.organization",
					"The organization's name.",
				),
				role: t(
					"personalDataExport.readme.fields.employment.employee.role",
					"Your role in the app: admin, manager or employee.",
				),
				personnel_number: t(
					"personalDataExport.readme.fields.employment.employee.personnelNumber",
					"Your personnel number.",
				),
				position: t(
					"personalDataExport.readme.fields.employment.employee.position",
					"Your position or job title.",
				),
				primary_team: t(
					"personalDataExport.readme.fields.employment.employee.primaryTeam",
					"Your primary team.",
				),
				contract_type: t(
					"personalDataExport.readme.fields.employment.employee.contractType",
					"Your contract type.",
				),
				current_hourly_rate: t(
					"personalDataExport.readme.fields.employment.employee.currentHourlyRate",
					"Your current hourly wage.",
				),
				start_date: t(
					"personalDataExport.readme.fields.employment.employee.startDate",
					"When your employment started.",
				),
				end_date: t(
					"personalDataExport.readme.fields.employment.employee.endDate",
					"When your employment ended; empty while it continues.",
				),
				is_active: t(
					"personalDataExport.readme.fields.employment.employee.isActive",
					"Whether your employee record is active.",
				),
			},
		},
		employment_periods: {
			summary: t(
				"personalDataExport.readme.fields.employment.employmentPeriods.summary",
				"Each period you were employed by the organization.",
			),
			fields: {
				...common("id", "created_at", "created_by"),
				status: t(
					"personalDataExport.readme.fields.employment.employmentPeriods.status",
					"Whether the period is open or closed.",
				),
				started_at: t(
					"personalDataExport.readme.fields.employment.employmentPeriods.startedAt",
					"When the period started.",
				),
				ended_at: t(
					"personalDataExport.readme.fields.employment.employmentPeriods.endedAt",
					"When the period ended; empty while it is open.",
				),
				start_provenance: t(
					"personalDataExport.readme.fields.employment.employmentPeriods.startProvenance",
					"Where the start comes from, for example a hire or a rehire.",
				),
			},
		},
		departures: {
			summary: t(
				"personalDataExport.readme.fields.employment.departures.summary",
				"Your departures from the organization.",
			),
			fields: {
				...common("id", "created_at", "created_by"),
				mode: t(
					"personalDataExport.readme.fields.employment.departures.mode",
					"How the departure was set up.",
				),
				status: t(
					"personalDataExport.readme.fields.employment.departures.status",
					"Where the departure stands.",
				),
				last_working_day: t(
					"personalDataExport.readme.fields.employment.departures.lastWorkingDay",
					"Your last working day (YYYY-MM-DD).",
				),
				timezone: t(
					"personalDataExport.readme.fields.employment.departures.timezone",
					"The time zone of the last working day.",
				),
				cutoff_at: t(
					"personalDataExport.readme.fields.employment.departures.cutoffAt",
					"When your access to the organization ends.",
				),
				effective_at: t(
					"personalDataExport.readme.fields.employment.departures.effectiveAt",
					"When the departure took effect.",
				),
				replacement: t(
					"personalDataExport.readme.fields.employment.departures.replacement",
					"The colleague who takes over your work.",
				),
				blocked_reason: t(
					"personalDataExport.readme.fields.employment.departures.blockedReason",
					"Why the departure could not complete, if it could not.",
				),
			},
		},
		departure_events: {
			summary: t(
				"personalDataExport.readme.fields.employment.departureEvents.summary",
				"The history of your departures: when each was scheduled, changed, canceled or took effect, and who did it.",
			),
			fields: {
				departure_id: t(
					"personalDataExport.readme.fields.employment.departureEvents.departureId",
					"The departure this event belongs to (its id in departures).",
				),
				kind: t(
					"personalDataExport.readme.fields.employment.departureEvents.kind",
					"What happened, for example departure_scheduled or departure_effective.",
				),
				revision: t(
					"personalDataExport.readme.fields.employment.departureEvents.revision",
					"The version of the departure after this event.",
				),
				occurred_at: t(
					"personalDataExport.readme.fields.employment.departureEvents.occurredAt",
					"When it happened.",
				),
				actor: t(
					"personalDataExport.readme.fields.employment.departureEvents.actor",
					"Who did it; empty when the system did.",
				),
			},
		},
		employment_terms: {
			summary: t(
				"personalDataExport.readme.fields.employment.employmentTerms.summary",
				"Your employment terms over time, with your hourly wage.",
			),
			fields: {
				...common("id", "created_at", "created_by", "updated_at", "updated_by"),
				valid_from: t(
					"personalDataExport.readme.fields.employment.employmentTerms.validFrom",
					"When these terms start to apply.",
				),
				valid_until: t(
					"personalDataExport.readme.fields.employment.employmentTerms.validUntil",
					"When these terms stop applying; empty while they apply.",
				),
				status: t(
					"personalDataExport.readme.fields.employment.employmentTerms.status",
					"Whether these terms are in force.",
				),
				contract_type: t(
					"personalDataExport.readme.fields.employment.employmentTerms.contractType",
					"Your contract type.",
				),
				weekly_contract_minutes: t(
					"personalDataExport.readme.fields.employment.employmentTerms.weeklyContractMinutes",
					"Your contractual working time per week, in minutes.",
				),
				probation_starts_on: t(
					"personalDataExport.readme.fields.employment.employmentTerms.probationStartsOn",
					"The first day of your probation (YYYY-MM-DD).",
				),
				probation_ends_on: t(
					"personalDataExport.readme.fields.employment.employmentTerms.probationEndsOn",
					"The last day of your probation (YYYY-MM-DD).",
				),
				work_model: t(
					"personalDataExport.readme.fields.employment.employmentTerms.workModel",
					"Your work model.",
				),
				work_policy: t(
					"personalDataExport.readme.fields.employment.employmentTerms.workPolicy",
					"The work policy these terms use.",
				),
				hourly_rate: t(
					"personalDataExport.readme.fields.employment.employmentTerms.hourlyRate",
					"Your hourly wage under these terms.",
				),
				currency: t(
					"personalDataExport.readme.fields.employment.employmentTerms.currency",
					"The currency of the hourly wage.",
				),
				change_reason: t(
					"personalDataExport.readme.fields.employment.employmentTerms.changeReason",
					"Why the terms were set or changed.",
				),
				review_state: t(
					"personalDataExport.readme.fields.employment.employmentTerms.reviewState",
					"Whether the terms were confirmed or still need a review.",
				),
			},
		},
		wage_history: {
			summary: t(
				"personalDataExport.readme.fields.employment.wageHistory.summary",
				"Your earlier hourly wages, as recorded before employment terms.",
			),
			fields: {
				...common("effective_from", "effective_to", "created_at", "created_by"),
				hourly_rate: t(
					"personalDataExport.readme.fields.employment.wageHistory.hourlyRate",
					"Your hourly wage.",
				),
				currency: t(
					"personalDataExport.readme.fields.employment.wageHistory.currency",
					"The currency of the hourly wage.",
				),
				reason: t(
					"personalDataExport.readme.fields.employment.wageHistory.reason",
					"Why the wage changed.",
				),
			},
		},
		teams: {
			summary: t(
				"personalDataExport.readme.fields.employment.teams.summary",
				"The teams you are in now.",
			),
			fields: {
				team: team(),
				primary: primary(),
				member_since: t(
					"personalDataExport.readme.fields.employment.teams.memberSince",
					"Since when you are in the team.",
				),
				added_by: t(
					"personalDataExport.readme.fields.employment.teams.addedBy",
					"Who added you to the team.",
				),
			},
		},
		team_history: {
			summary: t(
				"personalDataExport.readme.fields.employment.teamHistory.summary",
				"Every team you were in, and when.",
			),
			fields: { team: team(), ...common("effective_from", "effective_to") },
		},
		managers: {
			summary: t("personalDataExport.readme.fields.employment.managers.summary", "Your managers."),
			fields: {
				manager: t(
					"personalDataExport.readme.fields.employment.managers.manager",
					"The manager's name.",
				),
				primary: primary(),
				...common("assigned_at", "assigned_by"),
			},
		},
		team_permissions: {
			summary: t(
				"personalDataExport.readme.fields.employment.teamPermissions.summary",
				"The team permissions you hold.",
			),
			fields: {
				team: t(
					"personalDataExport.readme.fields.employment.teamPermissions.team",
					"The team the permissions apply to; empty for every team of the organization.",
				),
				can_create_teams: t(
					"personalDataExport.readme.fields.employment.teamPermissions.canCreateTeams",
					"Whether you may create teams.",
				),
				can_manage_team_members: t(
					"personalDataExport.readme.fields.employment.teamPermissions.canManageTeamMembers",
					"Whether you may manage the team's members.",
				),
				can_manage_team_settings: t(
					"personalDataExport.readme.fields.employment.teamPermissions.canManageTeamSettings",
					"Whether you may change the team's settings.",
				),
				can_approve_team_requests: t(
					"personalDataExport.readme.fields.employment.teamPermissions.canApproveTeamRequests",
					"Whether you may approve the team's requests.",
				),
				granted_at: t(
					"personalDataExport.readme.fields.employment.teamPermissions.grantedAt",
					"When the permissions were granted.",
				),
				granted_by: t(
					"personalDataExport.readme.fields.employment.teamPermissions.grantedBy",
					"Who granted the permissions.",
				),
			},
		},
		assigned_locations: {
			summary: t(
				"personalDataExport.readme.fields.employment.assignedLocations.summary",
				"The locations you are assigned to work at.",
			),
			fields: {
				location: t(
					"personalDataExport.readme.fields.employment.assignedLocations.location",
					"The location's name.",
				),
				street: t(
					"personalDataExport.readme.fields.employment.assignedLocations.street",
					"The location's street.",
				),
				city: t(
					"personalDataExport.readme.fields.employment.assignedLocations.city",
					"The location's city.",
				),
				postal_code: t(
					"personalDataExport.readme.fields.employment.assignedLocations.postalCode",
					"The location's postal code.",
				),
				country: t(
					"personalDataExport.readme.fields.employment.assignedLocations.country",
					"The location's country.",
				),
				...common("assigned_at", "assigned_by"),
			},
		},
		location_supervision: {
			summary: t(
				"personalDataExport.readme.fields.employment.locationSupervision.summary",
				"The locations and areas you supervise.",
			),
			fields: {
				location: t(
					"personalDataExport.readme.fields.employment.locationSupervision.location",
					"The location's name.",
				),
				subarea: t(
					"personalDataExport.readme.fields.employment.locationSupervision.subarea",
					"The area within the location; empty for the whole location.",
				),
				primary: primary(),
				...common("assigned_at", "assigned_by"),
			},
		},
		skills: {
			summary: t(
				"personalDataExport.readme.fields.employment.skills.summary",
				"Your skills and qualifications.",
			),
			fields: {
				skill: t("personalDataExport.readme.fields.employment.skills.skill", "The skill's name."),
				category: t(
					"personalDataExport.readme.fields.employment.skills.category",
					"The skill's category.",
				),
				expires_on: t(
					"personalDataExport.readme.fields.employment.skills.expiresOn",
					"The day the skill expires (YYYY-MM-DD); empty if it does not expire.",
				),
				notes: t(
					"personalDataExport.readme.fields.employment.skills.notes",
					"Notes on your skill.",
				),
				...common("assigned_at", "assigned_by"),
			},
		},
		project_assignments: {
			summary: t(
				"personalDataExport.readme.fields.employment.projectAssignments.summary",
				"The projects assigned to you or your teams.",
			),
			fields: {
				project: project(),
				assignment_type: assignmentType(),
				team: team(),
				...common("assigned_at", "assigned_by"),
			},
		},
		project_assignment_history: {
			summary: t(
				"personalDataExport.readme.fields.employment.projectAssignmentHistory.summary",
				"Earlier and current project assignments, and when they applied.",
			),
			fields: {
				project: project(),
				assignment_type: assignmentType(),
				team: team(),
				...common("effective_from", "effective_to", "assigned_by"),
			},
		},
		projects_managed: {
			summary: t(
				"personalDataExport.readme.fields.employment.projectsManaged.summary",
				"The projects you manage.",
			),
			fields: { project: project(), ...common("assigned_at", "assigned_by") },
		},
		assigned_vehicles: {
			summary: t(
				"personalDataExport.readme.fields.employment.assignedVehicles.summary",
				"The organization vehicles assigned to you or your teams, which the app suggests first when you record a vehicle on your work.",
			),
			fields: {
				vehicle: t(
					"personalDataExport.readme.fields.employment.assignedVehicles.vehicle",
					"The vehicle's name.",
				),
				licence_plate: t(
					"personalDataExport.readme.fields.employment.assignedVehicles.licencePlate",
					"The vehicle's licence plate.",
				),
				archived: t(
					"personalDataExport.readme.fields.employment.assignedVehicles.archived",
					"Whether the organization has archived the vehicle, so it can no longer be picked.",
				),
				assignment_type: t(
					"personalDataExport.readme.fields.employment.assignedVehicles.assignmentType",
					"How it reaches you: assigned to you (employee) or to your team (team).",
				),
				team: team(),
				...common("assigned_at", "assigned_by"),
			},
		},
		custom_roles: {
			summary: t(
				"personalDataExport.readme.fields.employment.customRoles.summary",
				"The custom roles you hold.",
			),
			fields: {
				role: t("personalDataExport.readme.fields.employment.customRoles.role", "The role's name."),
				description: t(
					"personalDataExport.readme.fields.employment.customRoles.description",
					"The role's description.",
				),
				...common("assigned_at", "assigned_by"),
			},
		},
		groups: {
			summary: t(
				"personalDataExport.readme.fields.employment.groups.summary",
				"The employee groups you belong to.",
			),
			fields: {
				group: t("personalDataExport.readme.fields.employment.groups.group", "The group's name."),
				description: t(
					"personalDataExport.readme.fields.employment.groups.description",
					"The group's description.",
				),
				added_at: t(
					"personalDataExport.readme.fields.employment.groups.addedAt",
					"When you were added to the group.",
				),
				added_by: t(
					"personalDataExport.readme.fields.employment.groups.addedBy",
					"Who added you to the group.",
				),
			},
		},
		cost_centers: {
			summary: t(
				"personalDataExport.readme.fields.employment.costCenters.summary",
				"The cost centres your work is booked to.",
			),
			fields: {
				cost_center: t(
					"personalDataExport.readme.fields.employment.costCenters.costCenter",
					"The cost centre's name.",
				),
				code: t(
					"personalDataExport.readme.fields.employment.costCenters.code",
					"The cost centre's code.",
				),
				...common("effective_from", "effective_to"),
			},
		},
		policy_assignments: {
			summary: t(
				"personalDataExport.readme.fields.employment.policyAssignments.summary",
				"Every policy that applies to you: assigned to you, to your teams, or the organization's default.",
			),
			fields: {
				policy_kind: t(
					"personalDataExport.readme.fields.employment.policyAssignments.policyKind",
					"The kind of policy: work, vacation, holiday (a holiday preset), holiday assignment (a single holiday), holiday category, change, surcharge, work category set or position capture.",
				),
				policy: t(
					"personalDataExport.readme.fields.employment.policyAssignments.policy",
					"The policy's name; empty for position capture.",
				),
				assignment_type: assignmentType(),
				team: team(),
				priority: t(
					"personalDataExport.readme.fields.employment.policyAssignments.priority",
					"Which assignment wins when several apply: the higher number wins.",
				),
				effective_from: t(
					"personalDataExport.readme.fields.employment.policyAssignments.effectiveFrom",
					"When the assignment starts to apply.",
				),
				effective_until: t(
					"personalDataExport.readme.fields.employment.policyAssignments.effectiveUntil",
					"When the assignment stops applying; empty while it applies.",
				),
				is_active: t(
					"personalDataExport.readme.fields.employment.policyAssignments.isActive",
					"Whether the assignment is active.",
				),
				capture_enabled: t(
					"personalDataExport.readme.fields.employment.policyAssignments.captureEnabled",
					"For position capture only: whether your position is captured when you clock in or out.",
				),
				...common("assigned_at", "assigned_by"),
			},
		},
		custom_fields: {
			summary: t(
				"personalDataExport.readme.fields.employment.customFields.summary",
				"The values of the organization's own fields on your employee record.",
			),
			fields: {
				field: t(
					"personalDataExport.readme.fields.employment.customFields.field",
					"The field's name.",
				),
				type: t(
					"personalDataExport.readme.fields.employment.customFields.type",
					"The field's type, for example text, number, date or choice.",
				),
				value: t("personalDataExport.readme.fields.employment.customFields.value", "The value."),
				valid_from: t(
					"personalDataExport.readme.fields.employment.customFields.validFrom",
					"For fields with a history: the day the value applies from (YYYY-MM-DD).",
				),
				tracked: t(
					"personalDataExport.readme.fields.employment.customFields.tracked",
					"Whether the field keeps a history of its values.",
				),
				field_archived: t(
					"personalDataExport.readme.fields.employment.customFields.fieldArchived",
					"Whether the organization archived the field.",
				),
				...common("updated_at", "updated_by"),
			},
		},
		// Withheld from the employee export (admin export only).
		billable_rates: {
			summary: t(
				"personalDataExport.readme.fields.employment.billableRates.summary",
				"The rates the organization bills to customers for your work.",
			),
			fields: {
				level: t(
					"personalDataExport.readme.fields.employment.billableRates.level",
					"Whether the rate applies to all your work or to one project.",
				),
				project: t(
					"personalDataExport.readme.fields.employment.billableRates.project",
					"The project the rate applies to; empty for all your work.",
				),
				hourly_rate: t(
					"personalDataExport.readme.fields.employment.billableRates.hourlyRate",
					"The billed rate per hour.",
				),
				...common("effective_from", "effective_to", "created_at", "created_by"),
				...common("updated_at", "updated_by"),
			},
		},
		cost_rates: {
			summary: t(
				"personalDataExport.readme.fields.employment.costRates.summary",
				"The internal cost of your work per hour, as the organization calculates it.",
			),
			fields: {
				hourly_rate: t(
					"personalDataExport.readme.fields.employment.costRates.hourlyRate",
					"The cost per hour.",
				),
				...common("effective_from", "effective_to", "created_at", "created_by"),
				...common("updated_at", "updated_by"),
			},
		},
		departure_tasks: {
			summary: t(
				"personalDataExport.readme.fields.employment.departureTasks.summary",
				"The tasks the app ran for your departure.",
			),
			fields: {
				...common("id", "created_at"),
				departure_id: t(
					"personalDataExport.readme.fields.employment.departureTasks.departureId",
					"The ID of the departure in departures.",
				),
				kind: t(
					"personalDataExport.readme.fields.employment.departureTasks.kind",
					"What the task does.",
				),
				status: t(
					"personalDataExport.readme.fields.employment.departureTasks.status",
					"Where the task stands.",
				),
				completed_at: t(
					"personalDataExport.readme.fields.employment.departureTasks.completedAt",
					"When the task completed.",
				),
			},
		},
		departure_reviews: {
			summary: t(
				"personalDataExport.readme.fields.employment.departureReviews.summary",
				"Records that needed a review because of your departure.",
			),
			fields: {
				...common("id", "created_at"),
				departure_id: t(
					"personalDataExport.readme.fields.employment.departureReviews.departureId",
					"The ID of the departure in departures.",
				),
				kind: t(
					"personalDataExport.readme.fields.employment.departureReviews.kind",
					"What kind of record needed the review.",
				),
				subject_id: t(
					"personalDataExport.readme.fields.employment.departureReviews.subjectId",
					"The ID of the record under review.",
				),
				status: t(
					"personalDataExport.readme.fields.employment.departureReviews.status",
					"Where the review stands.",
				),
				affected_start_at: t(
					"personalDataExport.readme.fields.employment.departureReviews.affectedStartAt",
					"The start of the time the record affects.",
				),
				affected_end_at: t(
					"personalDataExport.readme.fields.employment.departureReviews.affectedEndAt",
					"The end of the time the record affects.",
				),
				resolution: t(
					"personalDataExport.readme.fields.employment.departureReviews.resolution",
					"How the review was resolved.",
				),
				resolved_at: t(
					"personalDataExport.readme.fields.employment.departureReviews.resolvedAt",
					"When the review was resolved.",
				),
				resolved_by: t(
					"personalDataExport.readme.fields.employment.departureReviews.resolvedBy",
					"Who resolved the review.",
				),
			},
		},
	};
};
