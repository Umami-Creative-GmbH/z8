/**
 * The README's explanation of every part and field of the Planning category
 * (#811, #1172). See "Field guide" in `../collector.ts`.
 */

import { commonFieldExplanations, type PersonalDataFieldGuide } from "../collector";

export const planningFieldGuide: PersonalDataFieldGuide = (t) => {
	const common = (...names: Parameters<typeof commonFieldExplanations>[1]) =>
		commonFieldExplanations(t, names);
	const requestType = () =>
		t(
			"personalDataExport.readme.fields.planning.shared.requestType",
			"What was asked: swap (trade shifts), assignment (take over a shift) or pickup (take an open shift).",
		);
	const requestStatus = () =>
		t(
			"personalDataExport.readme.fields.planning.shared.requestStatus",
			"The decision on the request: pending, approved or rejected.",
		);
	const lifecycleStatus = () =>
		t(
			"personalDataExport.readme.fields.planning.shared.lifecycleStatus",
			"Where the request stands, including whether it was cancelled.",
		);
	const shiftDate = () =>
		t(
			"personalDataExport.readme.fields.planning.shared.shiftDate",
			"The day of the shift the request is about (YYYY-MM-DD).",
		);
	const shiftStartTime = () =>
		t(
			"personalDataExport.readme.fields.planning.shared.shiftStartTime",
			"When that shift starts, as local time of day (HH:mm).",
		);
	const shiftEndTime = () =>
		t(
			"personalDataExport.readme.fields.planning.shared.shiftEndTime",
			"When that shift ends, as local time of day (HH:mm).",
		);
	const approver = () =>
		t("personalDataExport.readme.fields.planning.shared.approver", "Who decided on the request.");
	const approvedAt = () =>
		t(
			"personalDataExport.readme.fields.planning.shared.approvedAt",
			"When the request was decided (UTC).",
		);
	const requestId = () =>
		t("personalDataExport.readme.fields.planning.shared.requestId", "The request's ID in the app.");
	const requestCreatedAt = () =>
		t(
			"personalDataExport.readme.fields.planning.shared.requestCreatedAt",
			"When the request was made (UTC).",
		);

	return {
		shifts: {
			summary: t(
				"personalDataExport.readme.fields.planning.shifts.summary",
				"The shifts you were scheduled for.",
			),
			fields: {
				...common("id", "created_at", "created_by"),
				date: t(
					"personalDataExport.readme.fields.planning.shifts.date",
					"The day of the shift (YYYY-MM-DD).",
				),
				start_time: t(
					"personalDataExport.readme.fields.planning.shifts.startTime",
					"When the shift starts, as local time of day at the workplace (HH:mm).",
				),
				end_time: t(
					"personalDataExport.readme.fields.planning.shifts.endTime",
					"When the shift ends, as local time of day at the workplace (HH:mm).",
				),
				status: t(
					"personalDataExport.readme.fields.planning.shifts.status",
					"Whether the shift is still a draft or published to you.",
				),
				template: t(
					"personalDataExport.readme.fields.planning.shifts.template",
					"The shift template the shift was made from.",
				),
				location: t(
					"personalDataExport.readme.fields.planning.shifts.location",
					"The location of the shift.",
				),
				subarea: t(
					"personalDataExport.readme.fields.planning.shifts.subarea",
					"The area within the location.",
				),
				notes: t(
					"personalDataExport.readme.fields.planning.shifts.notes",
					"The note written on the shift.",
				),
				published_at: t(
					"personalDataExport.readme.fields.planning.shifts.publishedAt",
					"When the shift was published (UTC).",
				),
				published_by: t(
					"personalDataExport.readme.fields.planning.shifts.publishedBy",
					"Who published the shift.",
				),
			},
		},
		shift_requests: {
			summary: t(
				"personalDataExport.readme.fields.planning.shiftRequests.summary",
				"The shift requests you made.",
			),
			fields: {
				id: requestId(),
				type: requestType(),
				status: requestStatus(),
				lifecycle_status: lifecycleStatus(),
				shift_date: shiftDate(),
				shift_start_time: shiftStartTime(),
				shift_end_time: shiftEndTime(),
				swap_partner: t(
					"personalDataExport.readme.fields.planning.shiftRequests.swapPartner",
					"The colleague you asked to swap with or to take the shift.",
				),
				reason: t(
					"personalDataExport.readme.fields.planning.shiftRequests.reason",
					"Your reason for the request.",
				),
				reason_category: t(
					"personalDataExport.readme.fields.planning.shiftRequests.reasonCategory",
					"The kind of reason, for example sick, emergency, childcare or other.",
				),
				notes: t(
					"personalDataExport.readme.fields.planning.shiftRequests.notes",
					"Your note on the request.",
				),
				approver: approver(),
				approved_at: approvedAt(),
				rejection_reason: t(
					"personalDataExport.readme.fields.planning.shiftRequests.rejectionReason",
					"Why the request was rejected.",
				),
				created_at: requestCreatedAt(),
			},
		},
		shift_requests_received: {
			summary: t(
				"personalDataExport.readme.fields.planning.shiftRequestsReceived.summary",
				"Requests colleagues made of you, such as asking you to swap or take a shift. Their reasons, notes and shifts are not included: the shift date and times appear only when the shift is yours.",
			),
			fields: {
				id: requestId(),
				type: requestType(),
				status: requestStatus(),
				lifecycle_status: lifecycleStatus(),
				shift_date: shiftDate(),
				shift_start_time: shiftStartTime(),
				shift_end_time: shiftEndTime(),
				requested_by: t(
					"personalDataExport.readme.fields.planning.shiftRequestsReceived.requestedBy",
					"The colleague who made the request.",
				),
				approver: approver(),
				approved_at: approvedAt(),
				created_at: requestCreatedAt(),
			},
		},
	};
};
