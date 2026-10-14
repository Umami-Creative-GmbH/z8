/**
 * The README's explanation of every part and field of the Absences category
 * (#811, #1172). See "Field guide" in `../collector.ts`.
 */

import { commonFieldExplanations, type PersonalDataFieldGuide } from "../collector";

export const absencesFieldGuide: PersonalDataFieldGuide = (t) => {
	const common = (...names: Parameters<typeof commonFieldExplanations>[1]) =>
		commonFieldExplanations(t, names);
	const year = () =>
		t("personalDataExport.readme.fields.absences.shared.year", "The vacation year.");

	return {
		absences: {
			summary: t(
				"personalDataExport.readme.fields.absences.absences.summary",
				"Your absences, such as vacation, sickness or home office, with their approval.",
			),
			fields: {
				...common("id", "created_at", "updated_at"),
				category: t(
					"personalDataExport.readme.fields.absences.absences.category",
					"The absence category, as the organization names it.",
				),
				category_type: t(
					"personalDataExport.readme.fields.absences.absences.categoryType",
					"The kind of absence behind the category, for example vacation, sick or home_office.",
				),
				start_date: t(
					"personalDataExport.readme.fields.absences.absences.startDate",
					"The first day of the absence (YYYY-MM-DD).",
				),
				start_period: t(
					"personalDataExport.readme.fields.absences.absences.startPeriod",
					"Which part of the first day you are absent: full_day, am (morning) or pm (afternoon).",
				),
				end_date: t(
					"personalDataExport.readme.fields.absences.absences.endDate",
					"The last day of the absence (YYYY-MM-DD).",
				),
				end_period: t(
					"personalDataExport.readme.fields.absences.absences.endPeriod",
					"Which part of the last day you are absent: full_day, am or pm.",
				),
				status: t(
					"personalDataExport.readme.fields.absences.absences.status",
					"Whether the absence is pending, approved or rejected.",
				),
				sick_detail: t(
					"personalDataExport.readme.fields.absences.absences.sickDetail",
					"For sickness: more detail, for example with or without a doctor's certificate, or a sick child.",
				),
				notes: t(
					"personalDataExport.readme.fields.absences.absences.notes",
					"The note written on the absence.",
				),
				deputy: t(
					"personalDataExport.readme.fields.absences.absences.deputy",
					"The colleague who stands in for you during the absence.",
				),
				deputy_assigned_at: t(
					"personalDataExport.readme.fields.absences.absences.deputyAssignedAt",
					"When the deputy was assigned (UTC).",
				),
				approved_by: t(
					"personalDataExport.readme.fields.absences.absences.approvedBy",
					"Who decided on the absence.",
				),
				approved_at: t(
					"personalDataExport.readme.fields.absences.absences.approvedAt",
					"When the absence was decided (UTC).",
				),
				rejection_reason: t(
					"personalDataExport.readme.fields.absences.absences.rejectionReason",
					"Why the absence was rejected.",
				),
			},
		},
		vacation_allowances: {
			summary: t(
				"personalDataExport.readme.fields.absences.vacationAllowances.summary",
				"Vacation allowances set for you personally, in place of your vacation policy, per year.",
			),
			fields: {
				...common("created_at", "updated_at"),
				year: year(),
				custom_annual_days: t(
					"personalDataExport.readme.fields.absences.vacationAllowances.customAnnualDays",
					"Your vacation days for the year; empty when your policy's number applies.",
				),
				custom_carryover_days: t(
					"personalDataExport.readme.fields.absences.vacationAllowances.customCarryoverDays",
					"The days carried over into this year from the year before; empty when none were set for you.",
				),
			},
		},
		vacation_policies: {
			summary: t(
				"personalDataExport.readme.fields.absences.vacationPolicies.summary",
				"The vacation policies that apply to you: assigned to you, to your teams, or the organization's default.",
			),
			fields: {
				policy: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.policy",
					"The policy's name.",
				),
				assignment_type: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.assignmentType",
					"How it reaches you: assigned to you (employee), to your team (team) or to the whole organization (organization).",
				),
				valid_from: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.validFrom",
					"The first day the policy applies (YYYY-MM-DD).",
				),
				valid_until: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.validUntil",
					"The last day the policy applies (YYYY-MM-DD); empty while it applies.",
				),
				default_annual_days: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.defaultAnnualDays",
					"The vacation days per year under the policy.",
				),
				accrual_type: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.accrualType",
					"How the days are granted: all at once per year (annual), monthly or every two weeks (biweekly).",
				),
				accrual_start_month: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.accrualStartMonth",
					"The month (1 to 12) the accrual of vacation days starts from.",
				),
				allow_carryover: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.allowCarryover",
					"Whether unused days carry over into the next year.",
				),
				max_carryover_days: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.maxCarryoverDays",
					"The most days that carry over; empty for no limit.",
				),
				carryover_expiry_months: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.carryoverExpiryMonths",
					"How many months into the next year carried-over days stay valid; empty if they do not expire.",
				),
				prorate_in_start_and_exit_year: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.prorateInStartAndExitYear",
					"Whether an annual allowance is reduced in the year you join or leave, by the months you are employed.",
				),
				statutory_minimum_days: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.statutoryMinimumDays",
					"The fewest days a reduced allowance can drop to once your waiting period is over.",
				),
				assignment_effective_from: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.assignmentEffectiveFrom",
					"When the assignment of the policy starts to apply (UTC).",
				),
				assignment_effective_until: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.assignmentEffectiveUntil",
					"When the assignment stops applying (UTC); empty while it applies.",
				),
				assignment_active: t(
					"personalDataExport.readme.fields.absences.vacationPolicies.assignmentActive",
					"Whether the assignment is active.",
				),
			},
		},
		vacation_adjustments: {
			summary: t(
				"personalDataExport.readme.fields.absences.vacationAdjustments.summary",
				"Every change to your vacation days besides your allowance: manual corrections and accrued shares.",
			),
			fields: {
				...common("created_at"),
				year: year(),
				days: t(
					"personalDataExport.readme.fields.absences.vacationAdjustments.days",
					"The days added (positive) or taken off (negative).",
				),
				kind: t(
					"personalDataExport.readme.fields.absences.vacationAdjustments.kind",
					"Whether someone made the change by hand (manual) or the app granted an accrued share (accrual).",
				),
				accrual_month: t(
					"personalDataExport.readme.fields.absences.vacationAdjustments.accrualMonth",
					"For an accrued share: the month (1 to 12) it was granted for.",
				),
				reason: t(
					"personalDataExport.readme.fields.absences.vacationAdjustments.reason",
					"Why the change was made.",
				),
				adjusted_by: t(
					"personalDataExport.readme.fields.absences.vacationAdjustments.adjustedBy",
					"Who made the change.",
				),
			},
		},
	};
};
