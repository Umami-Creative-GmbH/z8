/**
 * The README's explanation of every part and field of the Travel expenses
 * category (#811, #1172), the withheld columns of project attribution
 * exceptions included. See "Field guide" in `../collector.ts`.
 */

import { commonFieldExplanations, type PersonalDataFieldGuide } from "../collector";

export const travelExpensesFieldGuide: PersonalDataFieldGuide = (t) => {
	const common = (...names: Parameters<typeof commonFieldExplanations>[1]) =>
		commonFieldExplanations(t, names);
	const reportId = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.reportId",
			"The ID of the report in reports.",
		);
	const itemId = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.itemId",
			"The ID of the expense in report_items.",
		);
	const claimId = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.claimId",
			"The ID of the claim in claims.",
		);
	const project = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.project",
			"The project the expense is booked to.",
		);
	const currency = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.currency",
			"The currency, as a three-letter code such as EUR.",
		);
	const reason = () =>
		t("personalDataExport.readme.fields.travelExpenses.shared.reason", "The reason given.");
	const authorizedBy = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.authorizedBy",
			"The expense administrator who authorized it, by their name at the time.",
		);
	const authorizedAt = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.authorizedAt",
			"When it was authorized (UTC).",
		);
	const submittedAt = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.submittedAt",
			"When it was last submitted (UTC).",
		);
	const decidedAt = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.decidedAt",
			"When it was last approved, rejected or returned (UTC).",
		);
	const payrollRunId = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.payrollRunId",
			"The ID of the payroll run.",
		);
	const payrollRunPeriodStart = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.payrollRunPeriodStart",
			"The first day of the payroll run's period (YYYY-MM-DD).",
		);
	const payrollRunPeriodEnd = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.payrollRunPeriodEnd",
			"The last day of the payroll run's period (YYYY-MM-DD).",
		);
	const fileName = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.fileName",
			"The receipt's file name as uploaded.",
		);
	const mimeType = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.mimeType",
			"The file type, for example application/pdf or image/jpeg.",
		);
	const sizeBytes = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.sizeBytes",
			"The file size, in bytes.",
		);
	const uploadedBy = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.uploadedBy",
			"Who uploaded the receipt.",
		);
	const file = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.file",
			"Where the original receipt file is inside this archive.",
		);
	const originalAmount = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.originalAmount",
			"The amount as paid, in the original currency.",
		);
	const originalCurrency = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.originalCurrency",
			"The currency the amount was paid in.",
		);
	const tripStartDate = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.tripStartDate",
			"The first day of the trip (YYYY-MM-DD).",
		);
	const tripEndDate = () =>
		t(
			"personalDataExport.readme.fields.travelExpenses.shared.tripEndDate",
			"The last day of the trip (YYYY-MM-DD).",
		);

	return {
		claims: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.claims.summary",
				"Your travel expense claims made with the earlier, single-expense claim form.",
			),
			fields: {
				...common("id", "created_at", "created_by", "updated_at", "updated_by"),
				type: t(
					"personalDataExport.readme.fields.travelExpenses.claims.type",
					"The kind of expense: receipt, mileage or per_diem (daily allowance).",
				),
				status: t(
					"personalDataExport.readme.fields.travelExpenses.claims.status",
					"Whether the claim is a draft, submitted, approved or rejected.",
				),
				trip_start: t(
					"personalDataExport.readme.fields.travelExpenses.claims.tripStart",
					"The start of the trip (UTC).",
				),
				trip_end: t(
					"personalDataExport.readme.fields.travelExpenses.claims.tripEnd",
					"The end of the trip (UTC).",
				),
				trip_start_date: tripStartDate(),
				trip_end_date: tripEndDate(),
				trip_date_time_zone: t(
					"personalDataExport.readme.fields.travelExpenses.claims.tripDateTimeZone",
					"The time zone the trip days are counted in.",
				),
				destination_city: t(
					"personalDataExport.readme.fields.travelExpenses.claims.destinationCity",
					"The city you travelled to.",
				),
				destination_country: t(
					"personalDataExport.readme.fields.travelExpenses.claims.destinationCountry",
					"The country you travelled to.",
				),
				project: project(),
				original_amount: originalAmount(),
				original_currency: originalCurrency(),
				calculated_amount: t(
					"personalDataExport.readme.fields.travelExpenses.claims.calculatedAmount",
					"The amount to reimburse, as calculated.",
				),
				calculated_currency: t(
					"personalDataExport.readme.fields.travelExpenses.claims.calculatedCurrency",
					"The currency of the amount to reimburse.",
				),
				notes: t(
					"personalDataExport.readme.fields.travelExpenses.claims.notes",
					"Your notes on the claim.",
				),
				approver: t(
					"personalDataExport.readme.fields.travelExpenses.claims.approver",
					"Who decided on the claim.",
				),
				submitted_at: submittedAt(),
				decided_at: decidedAt(),
			},
		},
		claim_receipts: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.claimReceipts.summary",
				"The receipts attached to your claims. The files themselves are in the claim-receipts folder.",
			),
			fields: {
				...common("id", "created_at"),
				claim_id: claimId(),
				file_name: fileName(),
				mime_type: mimeType(),
				size_bytes: sizeBytes(),
				uploaded_by: uploadedBy(),
				file: file(),
			},
		},
		claim_decisions: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.claimDecisions.summary",
				"Every decision on your claims.",
			),
			fields: {
				claim_id: claimId(),
				action: t(
					"personalDataExport.readme.fields.travelExpenses.claimDecisions.action",
					"The decision: approved or rejected.",
				),
				reason: reason(),
				comment: t(
					"personalDataExport.readme.fields.travelExpenses.claimDecisions.comment",
					"The comment written with the decision.",
				),
				actor: t(
					"personalDataExport.readme.fields.travelExpenses.claimDecisions.actor",
					"Who made the decision.",
				),
				approver: t(
					"personalDataExport.readme.fields.travelExpenses.claimDecisions.approver",
					"The approver the claim was assigned to.",
				),
				created_at: t(
					"personalDataExport.readme.fields.travelExpenses.claimDecisions.createdAt",
					"When the decision was made (UTC).",
				),
			},
		},
		reports: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.reports.summary",
				"Your travel expense reports, each grouping the expenses of one trip or standalone expenses.",
			),
			fields: {
				...common("id", "created_at", "created_by", "updated_at", "updated_by"),
				kind: t(
					"personalDataExport.readme.fields.travelExpenses.reports.kind",
					"Whether the report is for a trip (trip) or for expenses without one (standalone).",
				),
				status: t(
					"personalDataExport.readme.fields.travelExpenses.reports.status",
					"Where the report stands: draft, submitted, approved, rejected, or returned to you for changes.",
				),
				reimbursement_currency: t(
					"personalDataExport.readme.fields.travelExpenses.reports.reimbursementCurrency",
					"The currency you are reimbursed in.",
				),
				trip_purpose: t(
					"personalDataExport.readme.fields.travelExpenses.reports.tripPurpose",
					"The purpose of the trip.",
				),
				trip_start_date: tripStartDate(),
				trip_end_date: tripEndDate(),
				trip_time_zone: t(
					"personalDataExport.readme.fields.travelExpenses.reports.tripTimeZone",
					"The time zone the trip days are counted in.",
				),
				trip_destinations: t(
					"personalDataExport.readme.fields.travelExpenses.reports.tripDestinations",
					"The places you travelled to, as JSON.",
				),
				project: t(
					"personalDataExport.readme.fields.travelExpenses.reports.project",
					"The trip's project, which its expenses use unless they name their own.",
				),
				submission_count: t(
					"personalDataExport.readme.fields.travelExpenses.reports.submissionCount",
					"How often the report was submitted.",
				),
				submitted_at: submittedAt(),
				decided_at: decidedAt(),
			},
		},
		report_items: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.reportItems.summary",
				"The expenses in your reports.",
			),
			fields: {
				...common("id", "created_at", "updated_at", "updated_by"),
				report_id: reportId(),
				type: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.type",
					"The kind of expense: receipt, mileage or per_diem (daily allowance).",
				),
				position: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.position",
					"The expense's position in the report.",
				),
				expense_date: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.expenseDate",
					"The day of the expense (YYYY-MM-DD).",
				),
				category: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.category",
					"The expense category, for example hotel, train or meals.",
				),
				description: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.description",
					"Your description of the expense.",
				),
				original_amount: originalAmount(),
				original_currency: originalCurrency(),
				paid_by: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.paidBy",
					"Who paid: you (employee) or the organization (company).",
				),
				accounting_reference: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.accountingReference",
					"A reference for bookkeeping, such as an invoice number.",
				),
				mileage_route: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.mileageRoute",
					"For mileage: the route you drove.",
				),
				mileage_distance_km: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.mileageDistanceKm",
					"For mileage: the distance, in kilometres.",
				),
				mileage_vehicle: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.mileageVehicle",
					"For mileage: the kind of vehicle.",
				),
				mileage_policy: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.mileagePolicy",
					"For mileage: the rates that priced it, as JSON, fixed when you submitted.",
				),
				receipt_exception_reason: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.receiptExceptionReason",
					"Your explanation of why a receipt is missing.",
				),
				project: project(),
				project_inherits: t(
					"personalDataExport.readme.fields.travelExpenses.reportItems.projectInherits",
					"Whether the expense uses the trip's project rather than its own.",
				),
			},
		},
		report_receipts: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.reportReceipts.summary",
				"The receipts attached to the expenses in your reports. The files themselves are in this category's folder.",
			),
			fields: {
				...common("id", "created_at"),
				report_id: reportId(),
				item_id: itemId(),
				file_name: fileName(),
				mime_type: mimeType(),
				size_bytes: sizeBytes(),
				uploaded_by: uploadedBy(),
				file: file(),
			},
		},
		per_diem_itineraries: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.summary",
				"The journeys your daily allowances (per diem) were calculated from.",
			),
			fields: {
				item_id: itemId(),
				report_id: reportId(),
				start_date: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.startDate",
					"The day you set off (YYYY-MM-DD).",
				),
				start_time: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.startTime",
					"The local time you set off (HH:mm).",
				),
				start_time_zone: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.startTimeZone",
					"The time zone of the departure.",
				),
				end_date: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.endDate",
					"The day you got back (YYYY-MM-DD).",
				),
				end_time: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.endTime",
					"The local time you got back (HH:mm).",
				),
				end_time_zone: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.endTimeZone",
					"The time zone of the return.",
				),
				overnight: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.overnight",
					"Whether and how you stayed overnight.",
				),
				prolonged_workplace: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.prolongedWorkplace",
					"Whether you worked at the same place away from home for a long time, which can reduce the allowance.",
				),
				meals: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.meals",
					"The meals provided to you per day, as JSON; they reduce the allowance.",
				),
				policy: t(
					"personalDataExport.readme.fields.travelExpenses.perDiemItineraries.policy",
					"The rates that priced the allowance, as JSON, fixed when you submitted.",
				),
			},
		},
		currency_conversions: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.currencyConversions.summary",
				"How expenses in a foreign currency were converted into your reimbursement currency.",
			),
			fields: {
				...common("created_at", "updated_at"),
				item_id: itemId(),
				report_id: reportId(),
				basis: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.basis",
					"How the amount was converted: what your card was actually charged (card_charge), a rate an administrator set (manual_rate), or a published reference rate (reference_rate).",
				),
				source_currency: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.sourceCurrency",
					"The currency converted from.",
				),
				target_currency: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.targetCurrency",
					"The currency converted into.",
				),
				charged_amount: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.chargedAmount",
					"For card_charge: the amount your card was charged, in the target currency.",
				),
				rate: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.rate",
					"The exchange rate: 1 unit of rate_base_currency equals this many units of rate_quote_currency.",
				),
				rate_base_currency: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.rateBaseCurrency",
					"The base currency of the rate.",
				),
				rate_quote_currency: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.rateQuoteCurrency",
					"The quote currency of the rate.",
				),
				rate_date: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.rateDate",
					"The day the rate is from (YYYY-MM-DD).",
				),
				reason: reason(),
				rate_evidence: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.rateEvidence",
					"Where the rate can be checked, such as a bank statement line.",
				),
				evidence_receipt_file: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.evidenceReceiptFile",
					"For card_charge: the receipt file inside this archive that shows the charge.",
				),
				reference_source: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.referenceSource",
					"For reference_rate: the published rate used, as JSON.",
				),
				reference_expense_date: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.referenceExpenseDate",
					"For reference_rate: the expense day the rate was chosen for (YYYY-MM-DD).",
				),
				authorized_by: authorizedBy(),
				authorized_at: authorizedAt(),
				recorded_by: t(
					"personalDataExport.readme.fields.travelExpenses.currencyConversions.recordedBy",
					"Who recorded the conversion.",
				),
			},
		},
		allowance_overrides: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.allowanceOverrides.summary",
				"Mileage or daily allowances an expense administrator set by hand where the rules gave no amount.",
			),
			fields: {
				...common("id"),
				report_id: reportId(),
				item_id: itemId(),
				kind: t(
					"personalDataExport.readme.fields.travelExpenses.allowanceOverrides.kind",
					"Which allowance was set: mileage or per_diem.",
				),
				amount: t(
					"personalDataExport.readme.fields.travelExpenses.allowanceOverrides.amount",
					"The amount set.",
				),
				currency: currency(),
				reason: reason(),
				evidence: t(
					"personalDataExport.readme.fields.travelExpenses.allowanceOverrides.evidence",
					"What the amount is based on.",
				),
				calculation_basis: t(
					"personalDataExport.readme.fields.travelExpenses.allowanceOverrides.calculationBasis",
					"How the amount was worked out.",
				),
				scope: t(
					"personalDataExport.readme.fields.travelExpenses.allowanceOverrides.scope",
					"Which part of the expense the amount covers, as JSON.",
				),
				situation: t(
					"personalDataExport.readme.fields.travelExpenses.allowanceOverrides.situation",
					"Why the rules gave no amount, as JSON.",
				),
				authorized_by: authorizedBy(),
				authorized_at: authorizedAt(),
				revoked_by: t(
					"personalDataExport.readme.fields.travelExpenses.allowanceOverrides.revokedBy",
					"Who withdrew the amount, by their name at the time.",
				),
				revoked_at: t(
					"personalDataExport.readme.fields.travelExpenses.allowanceOverrides.revokedAt",
					"When the amount was withdrawn (UTC); empty if it still applies.",
				),
			},
		},
		review_cycle_closures: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.reviewCycleClosures.summary",
				"Submissions of your reports that ended without a final decision: returned to you, withdrawn or reopened.",
			),
			fields: {
				...common("id"),
				report_id: reportId(),
				submission_cycle: t(
					"personalDataExport.readme.fields.travelExpenses.reviewCycleClosures.submissionCycle",
					"Which submission of the report it was: 1 is the first.",
				),
				kind: t(
					"personalDataExport.readme.fields.travelExpenses.reviewCycleClosures.kind",
					"How the submission ended: returned, withdrawn or reopened.",
				),
				note: t(
					"personalDataExport.readme.fields.travelExpenses.reviewCycleClosures.note",
					"The note written when it ended.",
				),
				actor: t(
					"personalDataExport.readme.fields.travelExpenses.reviewCycleClosures.actor",
					"Who ended it.",
				),
				created_at: t(
					"personalDataExport.readme.fields.travelExpenses.reviewCycleClosures.createdAt",
					"When it ended (UTC).",
				),
			},
		},
		review_notes: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.reviewNotes.summary",
				"A reviewer's comments on single expenses of a report returned to you.",
			),
			fields: {
				...common("created_at"),
				closure_id: t(
					"personalDataExport.readme.fields.travelExpenses.reviewNotes.closureId",
					"The ID of the returned submission in review_cycle_closures.",
				),
				item_id: itemId(),
				body: t("personalDataExport.readme.fields.travelExpenses.reviewNotes.body", "The comment."),
			},
		},
		adjustments: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.adjustments.summary",
				"Reports that correct an already exported or reimbursed report.",
			),
			fields: {
				...common("created_by", "created_at"),
				report_id: t(
					"personalDataExport.readme.fields.travelExpenses.adjustments.reportId",
					"The ID of the correcting report in reports.",
				),
				original_report_id: t(
					"personalDataExport.readme.fields.travelExpenses.adjustments.originalReportId",
					"The ID of the report being corrected.",
				),
				source_report_id: t(
					"personalDataExport.readme.fields.travelExpenses.adjustments.sourceReportId",
					"The ID of the report the correction was copied from: the original or its latest correction.",
				),
				reason: reason(),
			},
		},
		legacy_draft_conversions: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.legacyDraftConversions.summary",
				"Draft claims from the earlier claim form that were moved into a report.",
			),
			fields: {
				claim_id: claimId(),
				report_id: reportId(),
				item_id: itemId(),
				legacy_facts: t(
					"personalDataExport.readme.fields.travelExpenses.legacyDraftConversions.legacyFacts",
					"What the draft claim held when it was moved, as JSON.",
				),
				flags: t(
					"personalDataExport.readme.fields.travelExpenses.legacyDraftConversions.flags",
					"Anything that could not be moved as it was, as JSON.",
				),
				converted_by: t(
					"personalDataExport.readme.fields.travelExpenses.legacyDraftConversions.convertedBy",
					"Who moved the draft.",
				),
				converted_at: t(
					"personalDataExport.readme.fields.travelExpenses.legacyDraftConversions.convertedAt",
					"When the draft was moved (UTC).",
				),
			},
		},
		settlement_entries: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.settlementEntries.summary",
				"Money paid to you for approved expenses, or paid back by you after an overpayment.",
			),
			fields: {
				...common("id"),
				source_type: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.sourceType",
					"What the money is for: a report or a claim from the earlier form (legacy_claim).",
				),
				report_id: reportId(),
				legacy_claim_id: claimId(),
				kind: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.kind",
					"Whether you were paid (reimbursement) or paid money back (recovery).",
				),
				amount: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.amount",
					"The amount.",
				),
				currency: currency(),
				occurred_on: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.occurredOn",
					"The day the money moved (YYYY-MM-DD).",
				),
				reference: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.reference",
					"The payment reference, such as a bank transfer reference.",
				),
				note: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.note",
					"The note written with the payment.",
				),
				basis_submission_cycle: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.basisSubmissionCycle",
					"Which approved submission of the report the payment is based on.",
				),
				balance_before: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.balanceBefore",
					"What was still owed before this payment.",
				),
				recorded_by: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.recordedBy",
					"Who recorded the payment.",
				),
				recorded_at: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.recordedAt",
					"When the payment was recorded (UTC).",
				),
				export_batch_id: t(
					"personalDataExport.readme.fields.travelExpenses.settlementEntries.exportBatchId",
					"The ID of the expense export the payment was recorded for.",
				),
				payroll_run_id: payrollRunId(),
				payroll_run_period_start: payrollRunPeriodStart(),
				payroll_run_period_end: payrollRunPeriodEnd(),
			},
		},
		payroll_run_inclusions: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.payrollRunInclusions.summary",
				"Reports paid out to you through payroll.",
			),
			fields: {
				report_id: reportId(),
				payroll_run_id: payrollRunId(),
				payroll_run_period_start: payrollRunPeriodStart(),
				payroll_run_period_end: payrollRunPeriodEnd(),
				lines: t(
					"personalDataExport.readme.fields.travelExpenses.payrollRunInclusions.lines",
					"The amounts passed to payroll, with their wage types, as JSON.",
				),
				state: t(
					"personalDataExport.readme.fields.travelExpenses.payrollRunInclusions.state",
					"Where the inclusion stands: included, confirmed, removed, discarded, or superseded by a later run.",
				),
				included_at: t(
					"personalDataExport.readme.fields.travelExpenses.payrollRunInclusions.includedAt",
					"When the report was added to the run (UTC).",
				),
				ended_at: t(
					"personalDataExport.readme.fields.travelExpenses.payrollRunInclusions.endedAt",
					"When it was confirmed or stopped being included (UTC).",
				),
				ended_by: t(
					"personalDataExport.readme.fields.travelExpenses.payrollRunInclusions.endedBy",
					"Who confirmed, removed or discarded it.",
				),
			},
		},
		project_attribution_exceptions: {
			summary: t(
				"personalDataExport.readme.fields.travelExpenses.projectAttributionExceptions.summary",
				"Permissions to book your expenses to a project for days the app has no record of you working on it.",
			),
			fields: {
				project: t(
					"personalDataExport.readme.fields.travelExpenses.projectAttributionExceptions.project",
					"The project.",
				),
				valid_from: t(
					"personalDataExport.readme.fields.travelExpenses.projectAttributionExceptions.validFrom",
					"The first expense day covered (YYYY-MM-DD).",
				),
				valid_to: t(
					"personalDataExport.readme.fields.travelExpenses.projectAttributionExceptions.validTo",
					"The last expense day covered (YYYY-MM-DD).",
				),
				// Withheld from the employee export (admin export only).
				reason: t(
					"personalDataExport.readme.fields.travelExpenses.projectAttributionExceptions.reason",
					"The expense administrator's internal reason for the permission.",
				),
				evidence: t(
					"personalDataExport.readme.fields.travelExpenses.projectAttributionExceptions.evidence",
					"The expense administrator's internal note on the evidence.",
				),
				authorized_by: t(
					"personalDataExport.readme.fields.travelExpenses.projectAttributionExceptions.authorizedBy",
					"Who granted the permission.",
				),
				authorized_at: authorizedAt(),
			},
		},
	};
};
