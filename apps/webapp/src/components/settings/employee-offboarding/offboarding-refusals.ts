import type { RefusalOverrides } from "@/lib/organization-action/action-error-message";

/**
 * The employee offboarding texts (departures, rehires and their follow-up) for
 * `actionErrorMessage`, by the departure command's refusal code.
 */
export const OFFBOARDING_REFUSALS = {
	actor_not_authorized: [
		"settings.employees.offboarding.errors.actorNotAuthorized",
		"Only organization owners and admins can manage employee departures.",
	],
	self_target: [
		"settings.employees.offboarding.errors.selfTarget",
		"You cannot offboard or rehire your own employee profile.",
	],
	owner_authorization_required: [
		"settings.employees.offboarding.errors.ownerAuthorizationRequired",
		"Only an organization owner can offboard or rehire an owner.",
	],
	initiator_authorization_lost: [
		"settings.employees.offboarding.errors.initiatorAuthorizationLost",
		"Only organization owners and admins can manage employee departures.",
	],
	final_accessible_owner: [
		"settings.employees.offboarding.errors.finalAccessibleOwner",
		"Assign and activate another approved owner before this employee leaves.",
	],
	employee_not_found: [
		"settings.employees.offboarding.errors.employeeNotFound",
		"Employee not found.",
	],
	no_open_employment_period: [
		"settings.employees.offboarding.errors.noOpenEmploymentPeriod",
		"This employee has no current employment to end.",
	],
	departure_already_pending: [
		"settings.employees.offboarding.errors.departureAlreadyPending",
		"A departure is already scheduled for this employee. Edit or cancel it instead.",
	],
	departure_revision_conflict: [
		"settings.employees.offboarding.errors.departureRevisionConflict",
		"This departure changed in the meantime. Reload and review it before trying again.",
	],
	departure_already_effective: [
		"settings.employees.offboarding.errors.departureAlreadyEffective",
		"This departure has already taken effect. Rehire the employee to restore access.",
	],
	departure_date_in_past: [
		"settings.employees.offboarding.errors.departureDateInPast",
		"The last working day cannot be in the past.",
	],
	invalid_timezone: [
		"settings.employees.offboarding.errors.invalidTimezone",
		"The organization timezone is invalid. Fix it in organization settings first.",
	],
	replacement_invalid: [
		"settings.employees.offboarding.errors.replacementInvalid",
		"Choose an active colleague in this organization as the replacement.",
	],
	replacement_required: [
		"settings.employees.offboarding.errors.replacementRequired",
		"This employee has open approval duties. Choose a replacement or confirm admins will resolve them.",
	],
	request_conflict: [
		"settings.employees.offboarding.errors.requestConflict",
		"This request was already used for different details. Please try again.",
	],
	membership_required: [
		"settings.employees.offboarding.errors.membershipRequired",
		"This person is no longer an approved organization member. Re-invite them before rehiring.",
	],
	employee_already_employed: [
		"settings.employees.offboarding.errors.employeeAlreadyEmployed",
		"This employee is already employed.",
	],
	rehire_conflict: [
		"settings.employees.offboarding.errors.rehireConflict",
		"The previous employment period changed in the meantime. Reload and review it before trying again.",
	],
	rehire_terms_invalid: [
		"settings.employees.offboarding.errors.rehireTermsInvalid",
		"Choose a work policy, team and manager from this organization, and complete the contract terms.",
	],
	review_not_found: [
		"settings.employees.offboarding.errors.reviewNotFound",
		"This review no longer exists.",
	],
	review_already_resolved: [
		"settings.employees.offboarding.errors.reviewAlreadyResolved",
		"This review was already resolved.",
	],
	resolution_required: [
		"settings.employees.offboarding.errors.resolutionRequired",
		"Describe how the review was resolved.",
	],
	repair_incomplete: [
		"settings.employees.offboarding.errors.repairIncomplete",
		"The timer is still running. Correct it through time corrections before resolving this review.",
	],
	task_not_retryable: [
		"settings.employees.offboarding.errors.taskNotRetryable",
		"Only failed follow-up work can be retried.",
	],
	task_not_found: [
		"settings.employees.offboarding.errors.taskNotFound",
		"This handover no longer exists.",
	],
	task_in_progress: [
		"settings.employees.offboarding.errors.taskInProgress",
		"This handover is being processed. Try again in a moment.",
	],
	task_already_completed: [
		"settings.employees.offboarding.errors.taskAlreadyCompleted",
		"This handover is already complete.",
	],
	stage_not_waiting: [
		"settings.employees.offboarding.errors.stageNotWaiting",
		"This approval stage has already started. Manage it in approvals.",
	],
} satisfies RefusalOverrides;
