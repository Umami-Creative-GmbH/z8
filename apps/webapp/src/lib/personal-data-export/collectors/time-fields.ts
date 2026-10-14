/**
 * The README's explanation of every part and field of the Time category
 * (#811, #1172). See "Field guide" in `../collector.ts`.
 */

import { commonFieldExplanations, type PersonalDataFieldGuide } from "../collector";

export const timeFieldGuide: PersonalDataFieldGuide = (t) => {
	const common = (...names: Parameters<typeof commonFieldExplanations>[1]) =>
		commonFieldExplanations(t, names);
	const workPeriodId = () =>
		t(
			"personalDataExport.readme.fields.time.shared.workPeriodId",
			"The ID of the work period in work_periods.",
		);
	const actualMinutes = () =>
		t(
			"personalDataExport.readme.fields.time.shared.actualMinutes",
			"The minutes you worked, as counted for the balance.",
		);
	const requiredMinutes = () =>
		t(
			"personalDataExport.readme.fields.time.shared.requiredMinutes",
			"The minutes you were due to work under your work policy.",
		);
	const balanceMinutes = () =>
		t(
			"personalDataExport.readme.fields.time.shared.balanceMinutes",
			"Your balance in minutes: positive is overtime, negative is time still owed.",
		);
	const computedAt = () =>
		t(
			"personalDataExport.readme.fields.time.shared.computedAt",
			"When the app last calculated these figures (UTC).",
		);

	return {
		time_entries: {
			summary: t(
				"personalDataExport.readme.fields.time.timeEntries.summary",
				"Every clock-in, clock-out and correction recorded for you. Entries are never changed: a correction is a new entry that replaces the old one.",
			),
			fields: {
				...common("id", "created_at"),
				type: t(
					"personalDataExport.readme.fields.time.timeEntries.type",
					"What the entry records: clock_in, clock_out or correction.",
				),
				timestamp: t(
					"personalDataExport.readme.fields.time.timeEntries.timestamp",
					"The moment the entry stands for, in UTC.",
				),
				utc_offset_minutes: t(
					"personalDataExport.readme.fields.time.timeEntries.utcOffsetMinutes",
					"The UTC offset in effect where the entry was recorded, in minutes (120 means UTC+2). Add it to timestamp for the local time.",
				),
				timezone: t(
					"personalDataExport.readme.fields.time.timeEntries.timezone",
					"The time zone the entry was recorded in, for example Europe/Berlin.",
				),
				timezone_source: t(
					"personalDataExport.readme.fields.time.timeEntries.timezoneSource",
					"Where the time zone came from, for example your device or the organization's setting.",
				),
				replaces_entry_id: t(
					"personalDataExport.readme.fields.time.timeEntries.replacesEntryId",
					"For a correction: the ID of the entry it replaces.",
				),
				is_superseded: t(
					"personalDataExport.readme.fields.time.timeEntries.isSuperseded",
					"Whether a later correction replaced this entry.",
				),
				superseded_by_id: t(
					"personalDataExport.readme.fields.time.timeEntries.supersededById",
					"The ID of the correction that replaced this entry.",
				),
				notes: t(
					"personalDataExport.readme.fields.time.timeEntries.notes",
					"The note written on the entry.",
				),
				location: t(
					"personalDataExport.readme.fields.time.timeEntries.location",
					"The location recorded with the entry, as a place name or coordinates.",
				),
				ip_address: t(
					"personalDataExport.readme.fields.time.timeEntries.ipAddress",
					"The IP address of the device you recorded the entry with; empty when someone else recorded it.",
				),
				device_info: t(
					"personalDataExport.readme.fields.time.timeEntries.deviceInfo",
					"The device or browser you recorded the entry with; empty when someone else recorded it.",
				),
				created_by: t(
					"personalDataExport.readme.fields.time.timeEntries.createdBy",
					"Who recorded the entry: you, or the person who recorded it for you.",
				),
			},
		},
		work_periods: {
			summary: t(
				"personalDataExport.readme.fields.time.workPeriods.summary",
				"Your periods of work, each from a clock-in to a clock-out, with any change waiting for approval.",
			),
			fields: {
				...common("id", "created_at", "updated_at"),
				start_time: t(
					"personalDataExport.readme.fields.time.workPeriods.startTime",
					"When the work started (UTC).",
				),
				start_utc_offset_minutes: t(
					"personalDataExport.readme.fields.time.workPeriods.startUtcOffsetMinutes",
					"The UTC offset of the clock-in, in minutes (120 means UTC+2).",
				),
				end_time: t(
					"personalDataExport.readme.fields.time.workPeriods.endTime",
					"When the work ended (UTC); empty while you are still clocked in.",
				),
				end_utc_offset_minutes: t(
					"personalDataExport.readme.fields.time.workPeriods.endUtcOffsetMinutes",
					"The UTC offset of the clock-out, in minutes.",
				),
				duration_minutes: t(
					"personalDataExport.readme.fields.time.workPeriods.durationMinutes",
					"How long you worked, in minutes.",
				),
				is_active: t(
					"personalDataExport.readme.fields.time.workPeriods.isActive",
					"Whether you are still clocked in for this period.",
				),
				clock_in_entry_id: t(
					"personalDataExport.readme.fields.time.workPeriods.clockInEntryId",
					"The ID of the clock-in in time_entries.",
				),
				clock_out_entry_id: t(
					"personalDataExport.readme.fields.time.workPeriods.clockOutEntryId",
					"The ID of the clock-out in time_entries.",
				),
				project: t(
					"personalDataExport.readme.fields.time.workPeriods.project",
					"The project the work was booked to.",
				),
				task: t(
					"personalDataExport.readme.fields.time.workPeriods.task",
					"The project task the work was booked to.",
				),
				is_billable: t(
					"personalDataExport.readme.fields.time.workPeriods.isBillable",
					"Whether the work can be billed to a customer.",
				),
				work_category: t(
					"personalDataExport.readme.fields.time.workPeriods.workCategory",
					"The kind of work, as the organization names it.",
				),
				work_location_type: t(
					"personalDataExport.readme.fields.time.workPeriods.workLocationType",
					"Where you worked, for example office, home or remote.",
				),
				vehicle_kind: t(
					"personalDataExport.readme.fields.time.workPeriods.vehicleKind",
					"The vehicle you drove during the work: organization for a vehicle of the organization, own for your own vehicle; empty if none was recorded.",
				),
				vehicle_name: t(
					"personalDataExport.readme.fields.time.workPeriods.vehicleName",
					"The name of the organization vehicle you drove; empty for your own vehicle.",
				),
				licence_plate: t(
					"personalDataExport.readme.fields.time.workPeriods.licencePlate",
					"The licence plate of the organization vehicle you drove; empty for your own vehicle.",
				),
				odometer_start_km: t(
					"personalDataExport.readme.fields.time.workPeriods.odometerStartKm",
					"The vehicle's odometer reading when the work started, in kilometres.",
				),
				odometer_end_km: t(
					"personalDataExport.readme.fields.time.workPeriods.odometerEndKm",
					"The vehicle's odometer reading when the work ended, in kilometres.",
				),
				driven_distance_km: t(
					"personalDataExport.readme.fields.time.workPeriods.drivenDistanceKm",
					"The distance you drove during the work, in kilometres: the end reading minus the start reading, or the distance entered directly when there was no start reading.",
				),
				break_started_at: t(
					"personalDataExport.readme.fields.time.workPeriods.breakStartedAt",
					"When your current break started (UTC); empty when you are not on a break.",
				),
				break_started_zone: t(
					"personalDataExport.readme.fields.time.workPeriods.breakStartedZone",
					"The time zone the break was started in.",
				),
				approval_status: t(
					"personalDataExport.readme.fields.time.workPeriods.approvalStatus",
					"Whether the period is approved, rejected or waiting for approval.",
				),
				pending_start_time: t(
					"personalDataExport.readme.fields.time.workPeriods.pendingStartTime",
					"For a change waiting for approval: the requested start (UTC).",
				),
				pending_end_time: t(
					"personalDataExport.readme.fields.time.workPeriods.pendingEndTime",
					"For a change waiting for approval: the requested end (UTC).",
				),
				pending_duration_minutes: t(
					"personalDataExport.readme.fields.time.workPeriods.pendingDurationMinutes",
					"For a change waiting for approval: the requested duration, in minutes.",
				),
				pending_requested_at: t(
					"personalDataExport.readme.fields.time.workPeriods.pendingRequestedAt",
					"When the change was requested (UTC).",
				),
				pending_requested_by: t(
					"personalDataExport.readme.fields.time.workPeriods.pendingRequestedBy",
					"Who requested the change.",
				),
				pending_reason: t(
					"personalDataExport.readme.fields.time.workPeriods.pendingReason",
					"Why the change was requested.",
				),
				deleted_at: t(
					"personalDataExport.readme.fields.time.workPeriods.deletedAt",
					"When the period was deleted (UTC); empty if it was not.",
				),
				deleted_by: t(
					"personalDataExport.readme.fields.time.workPeriods.deletedBy",
					"Who deleted the period.",
				),
				deletion_reason: t(
					"personalDataExport.readme.fields.time.workPeriods.deletionReason",
					"Why the period was deleted.",
				),
			},
		},
		break_adjustments: {
			summary: t(
				"personalDataExport.readme.fields.time.breakAdjustments.summary",
				"Breaks the app added to a work period because the legally required break was missing.",
			),
			fields: {
				work_period_id: workPeriodId(),
				adjusted_at: t(
					"personalDataExport.readme.fields.time.breakAdjustments.adjustedAt",
					"When the app added the break (UTC).",
				),
				policy: t(
					"personalDataExport.readme.fields.time.breakAdjustments.policy",
					"The break rule that required the break.",
				),
				break_inserted_at: t(
					"personalDataExport.readme.fields.time.breakAdjustments.breakInsertedAt",
					"Where in the period the break was placed (UTC).",
				),
				break_inserted_minutes: t(
					"personalDataExport.readme.fields.time.breakAdjustments.breakInsertedMinutes",
					"How long the added break is, in minutes.",
				),
				required_break_minutes: t(
					"personalDataExport.readme.fields.time.breakAdjustments.requiredBreakMinutes",
					"The break the rule requires, in minutes.",
				),
				working_minutes_threshold: t(
					"personalDataExport.readme.fields.time.breakAdjustments.workingMinutesThreshold",
					"The working time, in minutes, after which the rule requires the break.",
				),
				original_end_time: t(
					"personalDataExport.readme.fields.time.breakAdjustments.originalEndTime",
					"The end of the period before the break was added (UTC).",
				),
				original_duration_minutes: t(
					"personalDataExport.readme.fields.time.breakAdjustments.originalDurationMinutes",
					"The duration of the period before the break was added, in minutes.",
				),
				adjusted_duration_minutes: t(
					"personalDataExport.readme.fields.time.breakAdjustments.adjustedDurationMinutes",
					"The duration of the period after the break was added, in minutes.",
				),
			},
		},
		work_operations: {
			summary: t(
				"personalDataExport.readme.fields.time.workOperations.summary",
				"A log of every change to your work periods: what was done, and by whom.",
			),
			fields: {
				work_period_id: workPeriodId(),
				kind: t(
					"personalDataExport.readme.fields.time.workOperations.kind",
					"What was done, for example a clock-in, an edit or a deletion.",
				),
				writer: t(
					"personalDataExport.readme.fields.time.workOperations.writer",
					"Which part of the app made the change, for example a clock-out in the web app, an import or an administrator's edit.",
				),
				actor_kind: t(
					"personalDataExport.readme.fields.time.workOperations.actorKind",
					"Who made the change: a person (human), the app itself (system), a kiosk, or unknown for old records.",
				),
				actor: t(
					"personalDataExport.readme.fields.time.workOperations.actor",
					"The person who made the change.",
				),
				created_at: t(
					"personalDataExport.readme.fields.time.workOperations.createdAt",
					"When the change was made (UTC).",
				),
			},
		},
		automatic_clock_outs: {
			summary: t(
				"personalDataExport.readme.fields.time.automaticClockOuts.summary",
				"Times the app clocked you out because you stayed clocked in longer than allowed.",
			),
			fields: {
				work_period_id: workPeriodId(),
				start_time: t(
					"personalDataExport.readme.fields.time.automaticClockOuts.startTime",
					"When the work period started (UTC).",
				),
				cutoff_time: t(
					"personalDataExport.readme.fields.time.automaticClockOuts.cutoffTime",
					"The time you were clocked out at (UTC).",
				),
				max_uninterrupted_minutes: t(
					"personalDataExport.readme.fields.time.automaticClockOuts.maxUninterruptedMinutes",
					"The longest time, in minutes, you may stay clocked in without a break.",
				),
				timezone: t(
					"personalDataExport.readme.fields.time.automaticClockOuts.timezone",
					"The time zone of the work period.",
				),
				utc_offset_minutes: t(
					"personalDataExport.readme.fields.time.automaticClockOuts.utcOffsetMinutes",
					"The UTC offset of the clock-out, in minutes.",
				),
				clock_out_entry_id: t(
					"personalDataExport.readme.fields.time.automaticClockOuts.clockOutEntryId",
					"The ID of the clock-out the app recorded, in time_entries.",
				),
				processed_at: t(
					"personalDataExport.readme.fields.time.automaticClockOuts.processedAt",
					"When the app clocked you out (UTC).",
				),
			},
		},
		historical_repair_proposals: {
			summary: t(
				"personalDataExport.readme.fields.time.historicalRepairProposals.summary",
				"Proposed repairs of older work records, for example a missing clock-out, and what became of them.",
			),
			fields: {
				...common("id"),
				kind: t(
					"personalDataExport.readme.fields.time.historicalRepairProposals.kind",
					"What the repair changes.",
				),
				status: t(
					"personalDataExport.readme.fields.time.historicalRepairProposals.status",
					"Where the proposal stands, for example proposed, approved, applied or rejected.",
				),
				work_period_id: workPeriodId(),
				reason: t(
					"personalDataExport.readme.fields.time.historicalRepairProposals.reason",
					"Why the repair was proposed.",
				),
				proposed_by: t(
					"personalDataExport.readme.fields.time.historicalRepairProposals.proposedBy",
					"Who proposed the repair.",
				),
				proposed_at: t(
					"personalDataExport.readme.fields.time.historicalRepairProposals.proposedAt",
					"When the repair was proposed (UTC).",
				),
				approved_by: t(
					"personalDataExport.readme.fields.time.historicalRepairProposals.approvedBy",
					"Who approved the repair.",
				),
				approved_at: t(
					"personalDataExport.readme.fields.time.historicalRepairProposals.approvedAt",
					"When the repair was approved (UTC).",
				),
				resolved_by: t(
					"personalDataExport.readme.fields.time.historicalRepairProposals.resolvedBy",
					"Who closed the proposal.",
				),
				resolved_at: t(
					"personalDataExport.readme.fields.time.historicalRepairProposals.resolvedAt",
					"When the proposal was closed (UTC).",
				),
			},
		},
		compliance_exceptions: {
			summary: t(
				"personalDataExport.readme.fields.time.complianceExceptions.summary",
				"Exceptions from working-time rules requested for you, such as a shorter rest period or extra overtime.",
			),
			fields: {
				...common("created_at", "created_by", "updated_at"),
				exception_type: t(
					"personalDataExport.readme.fields.time.complianceExceptions.exceptionType",
					"Which rule the exception is from, for example rest_period or overtime_daily.",
				),
				status: t(
					"personalDataExport.readme.fields.time.complianceExceptions.status",
					"Whether the exception is pending, approved, rejected, expired or used.",
				),
				reason: t(
					"personalDataExport.readme.fields.time.complianceExceptions.reason",
					"Why the exception was requested.",
				),
				planned_duration_minutes: t(
					"personalDataExport.readme.fields.time.complianceExceptions.plannedDurationMinutes",
					"The working time the exception was requested for, in minutes.",
				),
				valid_from: t(
					"personalDataExport.readme.fields.time.complianceExceptions.validFrom",
					"When the exception starts to apply (UTC).",
				),
				valid_until: t(
					"personalDataExport.readme.fields.time.complianceExceptions.validUntil",
					"When the exception stops applying (UTC).",
				),
				approver: t(
					"personalDataExport.readme.fields.time.complianceExceptions.approver",
					"Who decided on the exception.",
				),
				approved_at: t(
					"personalDataExport.readme.fields.time.complianceExceptions.approvedAt",
					"When the exception was approved (UTC).",
				),
				rejected_at: t(
					"personalDataExport.readme.fields.time.complianceExceptions.rejectedAt",
					"When the exception was rejected (UTC).",
				),
				rejection_reason: t(
					"personalDataExport.readme.fields.time.complianceExceptions.rejectionReason",
					"Why the exception was rejected.",
				),
				was_used: t(
					"personalDataExport.readme.fields.time.complianceExceptions.wasUsed",
					"Whether you worked under the exception.",
				),
				used_at: t(
					"personalDataExport.readme.fields.time.complianceExceptions.usedAt",
					"When you worked under the exception (UTC).",
				),
				actual_duration_minutes: t(
					"personalDataExport.readme.fields.time.complianceExceptions.actualDurationMinutes",
					"How long you actually worked under the exception, in minutes.",
				),
				work_period_id: workPeriodId(),
			},
		},
		work_policy_violations: {
			summary: t(
				"personalDataExport.readme.fields.time.workPolicyViolations.summary",
				"Times your work broke a rule of your work policy, for example a missing break or too long a day.",
			),
			fields: {
				...common("created_at"),
				policy: t(
					"personalDataExport.readme.fields.time.workPolicyViolations.policy",
					"The work policy whose rule was broken.",
				),
				work_period_id: workPeriodId(),
				violation_type: t(
					"personalDataExport.readme.fields.time.workPolicyViolations.violationType",
					"Which rule was broken.",
				),
				violated_at: t(
					"personalDataExport.readme.fields.time.workPolicyViolations.violatedAt",
					"When the rule was broken (UTC).",
				),
				details: t(
					"personalDataExport.readme.fields.time.workPolicyViolations.details",
					"The figures behind the violation, as JSON, for example the hours worked and the limit.",
				),
				acknowledged_by: t(
					"personalDataExport.readme.fields.time.workPolicyViolations.acknowledgedBy",
					"Who acknowledged the violation.",
				),
				acknowledged_at: t(
					"personalDataExport.readme.fields.time.workPolicyViolations.acknowledgedAt",
					"When the violation was acknowledged (UTC).",
				),
				acknowledged_note: t(
					"personalDataExport.readme.fields.time.workPolicyViolations.acknowledgedNote",
					"The note written when the violation was acknowledged.",
				),
			},
		},
		surcharge_calculations: {
			summary: t(
				"personalDataExport.readme.fields.time.surchargeCalculations.summary",
				"Surcharges calculated for your work, for example for night, Sunday or holiday work.",
			),
			fields: {
				...common("created_at"),
				work_period_id: workPeriodId(),
				surcharge_model: t(
					"personalDataExport.readme.fields.time.surchargeCalculations.surchargeModel",
					"The surcharge model that applied.",
				),
				surcharge_rule: t(
					"personalDataExport.readme.fields.time.surchargeCalculations.surchargeRule",
					"The rule of the model that applied.",
				),
				calculated_at: t(
					"personalDataExport.readme.fields.time.surchargeCalculations.calculatedAt",
					"The point in time the surcharge applies to (UTC).",
				),
				base_minutes: t(
					"personalDataExport.readme.fields.time.surchargeCalculations.baseMinutes",
					"The minutes worked in the period.",
				),
				qualifying_minutes: t(
					"personalDataExport.readme.fields.time.surchargeCalculations.qualifyingMinutes",
					"The minutes that qualify for the surcharge.",
				),
				surcharge_minutes: t(
					"personalDataExport.readme.fields.time.surchargeCalculations.surchargeMinutes",
					"The extra minutes credited as surcharge.",
				),
				applied_percentage: t(
					"personalDataExport.readme.fields.time.surchargeCalculations.appliedPercentage",
					"The surcharge rate, as a fraction (0.25 means 25%).",
				),
				calculation_details: t(
					"personalDataExport.readme.fields.time.surchargeCalculations.calculationDetails",
					"How the surcharge was calculated, as JSON.",
				),
			},
		},
		work_balance: {
			summary: t(
				"personalDataExport.readme.fields.time.workBalance.summary",
				"Your current working-time balance: the time you worked against the time you were due to work.",
			),
			fields: {
				actual_minutes: actualMinutes(),
				required_minutes: requiredMinutes(),
				adjustment_minutes: t(
					"personalDataExport.readme.fields.time.workBalance.adjustmentMinutes",
					"The minutes added or taken off by balance adjustments.",
				),
				balance_minutes: balanceMinutes(),
				computed_from_date: t(
					"personalDataExport.readme.fields.time.workBalance.computedFromDate",
					"The first day the balance counts (YYYY-MM-DD).",
				),
				computed_through_date: t(
					"personalDataExport.readme.fields.time.workBalance.computedThroughDate",
					"The last day the balance counts (YYYY-MM-DD).",
				),
				computed_at: computedAt(),
			},
		},
		work_balance_periods: {
			summary: t(
				"personalDataExport.readme.fields.time.workBalancePeriods.summary",
				"Your working-time balance per month and per year.",
			),
			fields: {
				period_type: t(
					"personalDataExport.readme.fields.time.workBalancePeriods.periodType",
					"The length of the period: month or year.",
				),
				period_start: t(
					"personalDataExport.readme.fields.time.workBalancePeriods.periodStart",
					"The first day of the period (YYYY-MM-DD).",
				),
				period_end: t(
					"personalDataExport.readme.fields.time.workBalancePeriods.periodEnd",
					"The last day of the period (YYYY-MM-DD).",
				),
				actual_minutes: actualMinutes(),
				required_minutes: requiredMinutes(),
				balance_minutes: balanceMinutes(),
				is_closed: t(
					"personalDataExport.readme.fields.time.workBalancePeriods.isClosed",
					"Whether the period is closed, so its figures no longer change.",
				),
				computed_at: computedAt(),
			},
		},
		yearly_balances: {
			summary: t(
				"personalDataExport.readme.fields.time.yearlyBalances.summary",
				"Your working-time balance per year, as calculated by an earlier version of the app.",
			),
			fields: {
				year: t("personalDataExport.readme.fields.time.yearlyBalances.year", "The year."),
				actual_minutes: actualMinutes(),
				expected_minutes: requiredMinutes(),
				absence_adjusted_minutes: t(
					"personalDataExport.readme.fields.time.yearlyBalances.absenceAdjustedMinutes",
					"The minutes credited for absences such as vacation or sickness.",
				),
				balance_minutes: balanceMinutes(),
				calculated_at: computedAt(),
			},
		},
		balance_adjustments: {
			summary: t(
				"personalDataExport.readme.fields.time.balanceAdjustments.summary",
				"Manual changes to your working-time balance, such as an opening balance or paid-out overtime, cancelled ones included.",
			),
			fields: {
				...common("id"),
				kind: t(
					"personalDataExport.readme.fields.time.balanceAdjustments.kind",
					"The kind of adjustment: opening_balance or overtime_payout.",
				),
				day: t(
					"personalDataExport.readme.fields.time.balanceAdjustments.day",
					"The day the adjustment counts on (YYYY-MM-DD).",
				),
				minutes: t(
					"personalDataExport.readme.fields.time.balanceAdjustments.minutes",
					"The minutes added to (positive) or taken off (negative) your balance.",
				),
				reason: t(
					"personalDataExport.readme.fields.time.balanceAdjustments.reason",
					"Why the adjustment was made.",
				),
				recorded_by: t(
					"personalDataExport.readme.fields.time.balanceAdjustments.recordedBy",
					"Who recorded the adjustment.",
				),
				recorded_at: t(
					"personalDataExport.readme.fields.time.balanceAdjustments.recordedAt",
					"When the adjustment was recorded (UTC).",
				),
				cancelled_at: t(
					"personalDataExport.readme.fields.time.balanceAdjustments.cancelledAt",
					"When the adjustment was cancelled (UTC); empty if it still counts.",
				),
				cancelled_by: t(
					"personalDataExport.readme.fields.time.balanceAdjustments.cancelledBy",
					"Who cancelled the adjustment.",
				),
				cancellation_reason: t(
					"personalDataExport.readme.fields.time.balanceAdjustments.cancellationReason",
					"Why the adjustment was cancelled.",
				),
			},
		},
	};
};
