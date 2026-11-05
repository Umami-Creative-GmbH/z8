import {
	commonFieldExplanations,
	type PersonalDataFieldGuide,
} from "../collector";

export const equipmentFieldGuide: PersonalDataFieldGuide = (t) => {
	const evidence = {
		...commonFieldExplanations(t, ["id"]),
		assignment_id: t(
			"personalDataExport.readme.fields.equipment.assignmentId",
			"The retained assignment this evidence belongs to; only your assignments in this organization are included.",
		),
		exception_id: t(
			"personalDataExport.readme.fields.equipment.exceptionId",
			"The linked lost or waived decision; a linked physical receipt supplements that decision rather than settling the same quantity twice. Empty for an ordinary handover.",
		),
		recorded_by: t(
			"personalDataExport.readme.fields.equipment.recordedBy",
			"The display name of the person who recorded this evidence, when their organization identity remains available; no other profile details are included.",
		),
		recorded_at: t(
			"personalDataExport.readme.fields.equipment.recordedAt",
			"The UTC entry timestamp, separate from the actual handover date; late entry does not change the handover date.",
		),
	};
	return {
		assignments: {
			summary: t(
				"personalDataExport.readme.fields.equipment.assignments.summary",
				"Your retained equipment agreements and current effective balances, terms and original employment/ending lineage. Lost and waived closures do not claim physical receipt; recovery overlaps its earlier closure. Removed personal history is never reconstructed from nonpersonal item identities.",
			),
			fields: {
				...commonFieldExplanations(t, ["id"]),
				type: t(
					"personalDataExport.readme.fields.equipment.type",
					"The equipment type's name.",
				),
				tracking_mode: t(
					"personalDataExport.readme.fields.equipment.trackingMode",
					"Individual identifies one physical item; quantity counts interchangeable items.",
				),
				identifier: t(
					"personalDataExport.readme.fields.equipment.identifier",
					"The organization's identifier of your individually tracked item, without other holders' history; empty for quantity assignments.",
				),
				serial_number: t(
					"personalDataExport.readme.fields.equipment.serialNumber",
					"The optional manufacturer serial number of the individually tracked item.",
				),
				quantity: t(
					"personalDataExport.readme.fields.equipment.assignmentQuantity",
					"The current effective issued quantity after corrections; original issuance and amendments remain separate evidence.",
				),
				return_required: t(
					"personalDataExport.readme.fields.equipment.returnRequired",
					"Whether return is required. False means issued to keep, with no return deadline or outstanding return; it does not mean physically returned.",
				),
				physically_received_quantity: t(
					"personalDataExport.readme.fields.equipment.physicallyReceivedQuantity",
					"The effective quantity physically received, including recovery and receipts of waived items. Lost and waived decisions alone never increase this count.",
				),
				lost_quantity: t(
					"personalDataExport.readme.fields.equipment.lostQuantity",
					"The effective quantity closed as lost, including any subsequently recovered quantity; the loss decision is preserved.",
				),
				waived_quantity: t(
					"personalDataExport.readme.fields.equipment.waivedQuantity",
					"The effective quantity whose required return was waived, including any subsequently received quantity; waiver does not claim receipt.",
				),
				exception_received_quantity: t(
					"personalDataExport.readme.fields.equipment.exceptionReceivedQuantity",
					"Physical receipts linked to lost or waived quantities; this overlap is counted once when computing outstanding returns.",
				),
				outstanding_quantity: t(
					"personalDataExport.readme.fields.equipment.outstandingQuantity",
					"Required quantity minus physical receipts and lost/waived closures, adding back their receipt overlap to avoid double settlement; zero for issued-to-keep equipment.",
				),
				explicit_deadline: t(
					"personalDataExport.readme.fields.equipment.explicitDeadline",
					"The separately agreed return date as a calendar day in the organization's timezone, or empty.",
				),
				departure_deadline: t(
					"personalDataExport.readme.fields.equipment.departureDeadline",
					"The return date derived from the original departure or deactivation; it survives later rehire or reactivation. Empty when no derived deadline applies.",
				),
				effective_deadline: t(
					"personalDataExport.readme.fields.equipment.effectiveDeadline",
					"The earlier applicable explicit or derived calendar deadline; issued-to-keep equipment has none. This is not a handover date or UTC entry timestamp.",
				),
				employment_period_id: t(
					"personalDataExport.readme.fields.equipment.employmentPeriodId",
					"The original employment period linked to this assignment, not automatically replaced by a later employment period; empty when no period was recorded.",
				),
				period_status: t(
					"personalDataExport.readme.fields.equipment.periodStatus",
					"The linked period's current open, closed or legacy_unknown status; reactivation may reopen this same period without changing the assignment's ending identity.",
				),
				period_started_at: t(
					"personalDataExport.readme.fields.equipment.periodStartedAt",
					"The linked employment period's recorded UTC start instant, or empty when unknown.",
				),
				period_ended_at: t(
					"personalDataExport.readme.fields.equipment.periodEndedAt",
					"The linked period's UTC end instant, or empty for an open/reopened period or an unknown end.",
				),
				departure_id: t(
					"personalDataExport.readme.fields.equipment.departureId",
					"The assignment's original linked departure identity, if any. Departure tasks and reviews are not equipment evidence.",
				),
				departure_mode: t(
					"personalDataExport.readme.fields.equipment.departureMode",
					"Whether the linked departure was scheduled or immediate, or empty without a linked departure.",
				),
				departure_status: t(
					"personalDataExport.readme.fields.equipment.departureStatus",
					"The linked departure's current status; a pending departure does not itself end employment.",
				),
				last_working_day: t(
					"personalDataExport.readme.fields.equipment.lastWorkingDay",
					"The linked scheduled departure's last working calendar day in its frozen timezone, or empty.",
				),
				departure_timezone: t(
					"personalDataExport.readme.fields.equipment.departureTimezone",
					"The timezone frozen on the linked departure; viewer timezone changes do not change its calendar meaning.",
				),
				departure_cutoff_at: t(
					"personalDataExport.readme.fields.equipment.departureCutoffAt",
					"The linked departure's UTC cutoff instant, separate from its last working calendar day and equipment deadline.",
				),
				deactivation_id: t(
					"personalDataExport.readme.fields.equipment.deactivationId",
					"The immutable deactivation identity for this assignment, even when reactivation reopens the same employment period.",
				),
				deactivated_at: t(
					"personalDataExport.readme.fields.equipment.deactivatedAt",
					"When that linked immediate deactivation ended employment/access, as a UTC instant; outstanding equipment never delays it.",
				),
				deactivation_timezone: t(
					"personalDataExport.readme.fields.equipment.deactivationTimezone",
					"The organization timezone captured on the original deactivation, or empty if it was not recorded. A later organization or viewer timezone never replaces that historical context.",
				),
				reactivated_at: t(
					"personalDataExport.readme.fields.equipment.reactivatedAt",
					"When that deactivation was later reactivated, as a UTC instant, or empty; reactivation does not erase old equipment obligations or deadlines.",
				),
			},
		},
		handovers: {
			summary: t(
				"personalDataExport.readme.fields.equipment.handovers.summary",
				"Original issuance and physical receipt evidence with current corrected values. A receipt linked to a lost decision is a recovery; a receipt linked to a waived decision records later physical receipt. An unknown historical issue date stays empty, never replaced by its UTC entry timestamp.",
			),
			fields: {
				...evidence,
				kind: t(
					"personalDataExport.readme.fields.equipment.handoverKind",
					"Issue records issuance; receipt records physical receipt, including a linked recovery. Neither lost nor waived closure is itself a handover.",
				),
				historical: t(
					"personalDataExport.readme.fields.equipment.historical",
					"True for entry of an already-held historical assignment; only historical issuance may have an explicitly unknown actual date.",
				),
				quantity: t(
					"personalDataExport.readme.fields.equipment.handoverQuantity",
					"The originally recorded handover quantity, preserved even after correction.",
				),
				actual_date: t(
					"personalDataExport.readme.fields.equipment.actualDate",
					"The original actual handover calendar date as recorded in the organization's timezone. Empty means explicitly unknown historical issue date, not the entry date.",
				),
				condition: t(
					"personalDataExport.readme.fields.equipment.condition",
					"The originally recorded good, worn, damaged or unknown condition; unknown condition does not imply an unknown date.",
				),
				notes: t(
					"personalDataExport.readme.fields.equipment.notes",
					"The original optional handover notes, preserved after correction while personal history is retained.",
				),
				effective_quantity: t(
					"personalDataExport.readme.fields.equipment.effectiveHandoverQuantity",
					"The handover quantity after corrections; zero reverses a mistaken receipt without erasing its original evidence.",
				),
				effective_actual_date: t(
					"personalDataExport.readme.fields.equipment.effectiveActualDate",
					"The actual handover calendar date after corrections; an unknown historical issue remains empty rather than falling back to its entry timestamp.",
				),
				effective_condition: t(
					"personalDataExport.readme.fields.equipment.effectiveCondition",
					"The condition after corrections; receiving damaged equipment does not itself grant clearance for reissue.",
				),
				effective_notes: t(
					"personalDataExport.readme.fields.equipment.effectiveNotes",
					"The current optional handover notes after corrections.",
				),
			},
		},
		exceptions: {
			summary: t(
				"personalDataExport.readme.fields.equipment.exceptions.summary",
				"Original reasoned lost and waived decisions and their current corrected values. These close return obligations without claiming physical receipt; linked receipt evidence records recovery or later return separately.",
			),
			fields: {
				...evidence,
				kind: t(
					"personalDataExport.readme.fields.equipment.exceptionKind",
					"The original lost or waived outcome; neither means equipment was physically returned.",
				),
				quantity: t(
					"personalDataExport.readme.fields.equipment.exceptionQuantity",
					"The original quantity closed by the decision, preserved after amendments or reversals.",
				),
				reason: t(
					"personalDataExport.readme.fields.equipment.exceptionReason",
					"The original mandatory reason for the loss or waiver decision.",
				),
				effective_kind: t(
					"personalDataExport.readme.fields.equipment.effectiveKind",
					"The current lost or waived outcome after corrections.",
				),
				effective_quantity: t(
					"personalDataExport.readme.fields.equipment.effectiveExceptionQuantity",
					"The quantity still closed by this decision after amendments or reversals, including its linked physical receipts; zero means fully reversed.",
				),
				effective_reason: t(
					"personalDataExport.readme.fields.equipment.effectiveReason",
					"The decision's current reason after corrections; correction reasons are retained separately.",
				),
				received_quantity: t(
					"personalDataExport.readme.fields.equipment.receivedQuantity",
					"The effective physical quantity received against this decision. For a lost decision this is recovered equipment; it is already included in assignment physical receipts.",
				),
			},
		},
		case_holds: {
			summary: t(
				"personalDataExport.readme.fields.equipment.holds.summary",
				"Documented case hold placements and releases on your retained equipment history. An active hold protects the evidence from cleanup; it never records physical receipt.",
			),
			fields: {
				...evidence,
				kind: t(
					"personalDataExport.readme.fields.equipment.holds.kind",
					"Whether the case hold was placed or released.",
				),
				reason: t(
					"personalDataExport.readme.fields.equipment.holds.reason",
					"The mandatory reason documented by the organization administrator for this specific case action.",
				),
				revision: t(
					"personalDataExport.readme.fields.equipment.holds.revision",
					"The assignment revision created by this case hold action.",
				),
			},
		},
		corrections: {
			summary: t(
				"personalDataExport.readme.fields.equipment.corrections.summary",
				"Reasoned before/after amendments to your retained handovers and decisions, including agreement changes. Original evidence remains separate; a transfer includes only your own handover and amendment, never the other holder's personal history.",
			),
			fields: {
				...evidence,
				handover_id: t(
					"personalDataExport.readme.fields.equipment.handoverId",
					"The amended handover's ID, or empty for an exception amendment.",
				),
				reason: t(
					"personalDataExport.readme.fields.equipment.correctionReason",
					"The mandatory explanation of why the correction was made.",
				),
				before: t(
					"personalDataExport.readme.fields.equipment.before",
					"JSON of effective values before this amendment: handover quantity, actualDate (null for unknown historical issuance), condition and notes, or exception kind, quantity and reason. Issuance amendments also retain prior returnRequired, explicitDeadline and original employment/departure/deactivation lineage.",
				),
				after: t(
					"personalDataExport.readme.fields.equipment.after",
					"JSON of values after this amendment, using the same evidence field meanings as before. Issuance agreement values include returnRequired, explicitDeadline and employmentPeriodId. Calendar dates are distinct from the amendment's UTC recorded_at.",
				),
			},
		},
	};
};
