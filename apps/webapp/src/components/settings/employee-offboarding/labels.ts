"use client";

import { useTranslate } from "@tolgee/react";
import type {
	DeparturePreviewException,
	EmployeeOffboardingState,
	OffboardingFollowUpTaskKind,
	OffboardingReviewKind,
} from "@/lib/employee-lifecycle/view-types";

/**
 * Offboarding labels with literal keys, so the Tolgee extractor sees every
 * one. Unknown machine reasons from newer servers fall back to null.
 */
export function useOffboardingLabels() {
	const { t } = useTranslate();

	const state = (value: EmployeeOffboardingState) => {
		switch (value) {
			case "active":
				return t("settings.employees.offboarding.states.active", "Employed");
			case "scheduled":
				return t("settings.employees.offboarding.states.scheduled", "Departure scheduled");
			case "blocked":
				return t("settings.employees.offboarding.states.blocked", "Departure blocked");
			case "offboarded":
				return t("settings.employees.offboarding.effective", "Departure effective");
			case "legacy_inactive":
				return t("settings.employees.offboarding.states.legacyInactive", "Inactive");
		}
	};

	const review = (kind: OffboardingReviewKind) => {
		switch (kind) {
			case "clock_out":
				return t(
					"settings.employees.offboarding.clockReview",
					"Needs review: offboarding clock-out",
				);
			case "clock_repair":
				return t("settings.employees.offboarding.reviews.clockRepair", "Timer repair required");
			case "approval_handover":
				return t(
					"settings.employees.offboarding.reviews.approvalHandover",
					"Approval duties need a replacement",
				);
			case "future_work":
				return t("settings.employees.offboarding.reviews.futureWork", "Future work needs review");
			case "employment_terms":
				return t(
					"settings.employees.offboarding.reviews.employmentTerms",
					"Future employment terms need review",
				);
		}
	};

	const task = (kind: OffboardingFollowUpTaskKind) => {
		switch (kind) {
			case "dispatch_departure":
				return t("settings.employees.offboarding.tasks.dispatchDeparture", "Departure scheduling");
			case "session_revocation":
				return t("settings.employees.offboarding.tasks.sessionRevocation", "Session sign-out");
			case "billing_sync":
				return t("settings.employees.offboarding.tasks.billingSync", "Billing seat update");
			case "clock_postprocess":
				return t(
					"settings.employees.offboarding.tasks.clockPostprocess",
					"Break and surcharge processing",
				);
			case "notify_review":
				return t("settings.employees.offboarding.tasks.notifyReview", "Review notification");
			case "clock_repair":
				return t("settings.employees.offboarding.tasks.clockRepair", "Timer repair");
			case "approval_handover":
				return t("settings.employees.offboarding.tasks.approvalHandover", "Approval handover");
		}
	};

	const reason = (value: string): string | null => {
		switch (value) {
			case "no_replacement":
				return t(
					"settings.employees.offboarding.reasons.noReplacement",
					"No replacement was chosen.",
				);
			case "target_ineligible":
				return t(
					"settings.employees.offboarding.reasons.targetIneligible",
					"The chosen replacement cannot decide these approvals.",
				);
			case "target_is_requester":
				return t(
					"settings.employees.offboarding.reasons.targetIsRequester",
					"The replacement requested this approval and cannot decide it.",
				);
			case "target_already_pending":
				return t(
					"settings.employees.offboarding.reasons.targetAlreadyPending",
					"The replacement already reviews this approval.",
				);
			case "legacy_authority":
				return t(
					"settings.employees.offboarding.reasons.legacyAuthority",
					"This approval cannot be transferred automatically. Reassign it in approvals.",
				);
			case "future_stage_without_replacement":
				return t(
					"settings.employees.offboarding.reasons.futureStage",
					"A later approval stage is routed only to this person. Assign a replacement before it starts; otherwise approving the stage before it fails.",
				);
			case "future_terms_after_departure":
				return t(
					"settings.employees.offboarding.reasons.futureTerms",
					"Confirmed terms start after the departure.",
				);
			case "future_assignments_deactivated":
				return t(
					"settings.employees.offboarding.reasons.futureAssignments",
					"Future work policy assignments were deactivated.",
				);
			case "clock_out_failed":
				return t(
					"settings.employees.offboarding.reasons.clockOutFailed",
					"The running timer could not be closed automatically.",
				);
			case "append_adopted":
				return t(
					"settings.employees.offboarding.reasons.appendAdopted",
					"The running timer was left open because this organization only accepts coordinated clock commands. Close it with a time correction.",
				);
			default:
				return null;
		}
	};

	const exception = (value: DeparturePreviewException) => {
		switch (value) {
			case "running_timer":
				return t(
					"settings.employees.offboarding.exceptions.runningTimer",
					"A running timer will be closed at the cutoff and marked for review.",
				);
			case "future_shifts":
				return t(
					"settings.employees.offboarding.exceptions.futureShifts",
					"Shifts after the cutoff remain assigned. Review them in scheduling.",
				);
			case "future_absences":
				return t(
					"settings.employees.offboarding.exceptions.futureAbsences",
					"Absences after the cutoff remain recorded. Review them in absences.",
				);
			case "unassigned_approval_duties":
				return t(
					"settings.employees.offboarding.exceptions.unassignedDuties",
					"This employee has open approval duties. Choose a replacement or confirm admins will resolve them.",
				);
			case "replacement_ineligible":
				return t(
					"settings.employees.offboarding.exceptions.replacementIneligible",
					"The chosen replacement cannot currently take over approvals. Choose another replacement.",
				);
			case "replacement_requested_duties":
				return t(
					"settings.employees.offboarding.exceptions.replacementRequestedDuties",
					"The replacement requested some of these approvals and cannot decide them. They will be listed for review.",
				);
			case "later_stages_without_replacement":
				return t(
					"settings.employees.offboarding.exceptions.laterStages",
					"Later approval stages are routed only to this employee. Choose a replacement, or assign one on each review.",
				);
			case "legacy_approval_duties":
				return t(
					"settings.employees.offboarding.exceptions.legacyDuties",
					"Some approvals cannot be transferred automatically and will be listed for review.",
				);
			case "owner_authorization_required":
				return t(
					"settings.employees.offboarding.exceptions.ownerAuthorization",
					"Only an organization owner can offboard an owner.",
				);
			case "final_accessible_owner":
				return t(
					"settings.employees.offboarding.exceptions.finalOwner",
					"Assign and activate another approved owner before this employee leaves.",
				);
		}
	};

	const blocked = (value: string | null) => {
		switch (value) {
			case "final_accessible_owner":
				return t(
					"settings.employees.offboarding.blocked.finalOwner",
					"Assign and activate another approved owner before this employee leaves.",
				);
			case "owner_authorization_required":
				return t(
					"settings.employees.offboarding.blocked.ownerAuthorization",
					"Only an organization owner can offboard an owner.",
				);
			case "initiator_authorization_lost":
				return t(
					"settings.employees.offboarding.blocked.initiatorLost",
					"The admin who scheduled this departure no longer has authority. Reschedule or cancel it.",
				);
			default:
				return t(
					"settings.employees.offboarding.blocked.unknown",
					"This departure could not take effect. Reschedule or cancel it.",
				);
		}
	};

	return { state, review, task, reason, exception, blocked };
}
