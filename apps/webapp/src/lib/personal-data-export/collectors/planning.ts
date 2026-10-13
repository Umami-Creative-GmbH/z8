/**
 * Planning category of a personal data export (#811, #1168).
 *
 * The shifts assigned to the employee (open shifts are nobody's data), the
 * shift requests they made, and the swap or assignment requests colleagues
 * made of them. Nothing here is withheld: both exports hold the same rows.
 *
 * Shift times are the zone-less local "HH:mm" text the shift stores, next to
 * its plain date. A swap partner, or the colleague who asked the employee to
 * take a shift, did not act on the employee's records: they appear by
 * display name only, and a received request carries none of the colleague's
 * reasons or notes, nor anything about their shift: its date and times appear
 * only when the shift is the employee's own (#811 decision).
 *
 * `shift_request.organization_id` is nullable, so requests are scoped through
 * their shift's organization.
 */

import { and, asc, eq, ne } from "drizzle-orm";
import {
	employee,
	location,
	locationSubarea,
	shift,
	shiftRequest,
	shiftTemplate,
} from "@/db/schema";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	tablePart,
} from "../collector";
import { instantText, loadEmployeeNames, loadUserNames, nameOf, plainDateText } from "../values";
import { PersonalDataSubjectNotFoundError } from "./employment";
import { planningFieldGuide } from "./planning-fields";

export const planningCollector: PersonalDataCollector = {
	category: "planning",
	collect: collectPlanning,
	fields: planningFieldGuide,
};

const requestShift = {
	shiftDate: shift.date,
	shiftStartTime: shift.startTime,
	shiftEndTime: shift.endTime,
};

async function collectPlanning(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const { organizationId, employeeId } = scope;
	const [subject] = await database
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
		.limit(1);
	if (!subject) throw new PersonalDataSubjectNotFoundError();

	const shiftInOrganization = and(
		eq(shift.id, shiftRequest.shiftId),
		eq(shift.organizationId, organizationId),
	);
	const [shifts, ownRequests, receivedRequests] = await Promise.all([
		database
			.select({
				shift,
				template: shiftTemplate.name,
				subarea: locationSubarea.name,
				location: location.name,
			})
			.from(shift)
			.leftJoin(
				shiftTemplate,
				and(
					eq(shiftTemplate.id, shift.templateId),
					eq(shiftTemplate.organizationId, organizationId),
				),
			)
			.leftJoin(locationSubarea, eq(locationSubarea.id, shift.subareaId))
			.leftJoin(
				location,
				and(
					eq(location.id, locationSubarea.locationId),
					eq(location.organizationId, organizationId),
				),
			)
			.where(and(eq(shift.organizationId, organizationId), eq(shift.employeeId, employeeId)))
			.orderBy(asc(shift.date), asc(shift.startTime)),
		database
			.select({ request: shiftRequest, ...requestShift })
			.from(shiftRequest)
			.innerJoin(shift, shiftInOrganization)
			.where(eq(shiftRequest.requesterId, employeeId))
			.orderBy(asc(shiftRequest.createdAt)),
		database
			.select({
				id: shiftRequest.id,
				type: shiftRequest.type,
				status: shiftRequest.status,
				lifecycleStatus: shiftRequest.lifecycleStatus,
				requesterId: shiftRequest.requesterId,
				approverId: shiftRequest.approverId,
				approvedAt: shiftRequest.approvedAt,
				createdAt: shiftRequest.createdAt,
				shiftEmployeeId: shift.employeeId,
				...requestShift,
			})
			.from(shiftRequest)
			.innerJoin(shift, shiftInOrganization)
			.where(
				and(
					eq(shiftRequest.targetEmployeeId, employeeId),
					ne(shiftRequest.requesterId, employeeId),
				),
			)
			.orderBy(asc(shiftRequest.createdAt)),
	]);

	const [userNames, employeeNames] = await Promise.all([
		loadUserNames(
			database,
			shifts.flatMap((row) => [row.shift.publishedBy, row.shift.createdBy]),
		),
		loadEmployeeNames(database, organizationId, [
			...ownRequests.flatMap((row) => [row.request.targetEmployeeId, row.request.approverId]),
			...receivedRequests.flatMap((row) => [row.requesterId, row.approverId]),
		]),
	]);
	const byUser = (id: string | null | undefined) => nameOf(userNames, id);
	const byEmployee = (id: string | null | undefined) => nameOf(employeeNames, id);

	return {
		category: "planning",
		parts: [
			tablePart(
				"shifts",
				[
					"id",
					"date",
					"start_time",
					"end_time",
					"status",
					"template",
					"location",
					"subarea",
					"notes",
					"published_at",
					"published_by",
					"created_at",
					"created_by",
				],
				shifts.map((row) => ({
					id: row.shift.id,
					date: plainDateText(row.shift.date),
					start_time: row.shift.startTime,
					end_time: row.shift.endTime,
					status: row.shift.status,
					template: row.template,
					location: row.location,
					subarea: row.location ? row.subarea : null,
					notes: row.shift.notes,
					published_at: instantText(row.shift.publishedAt),
					published_by: byUser(row.shift.publishedBy),
					created_at: instantText(row.shift.createdAt),
					created_by: byUser(row.shift.createdBy),
				})),
			),
			tablePart(
				"shift_requests",
				[
					"id",
					"type",
					"status",
					"lifecycle_status",
					"shift_date",
					"shift_start_time",
					"shift_end_time",
					"swap_partner",
					"reason",
					"reason_category",
					"notes",
					"approver",
					"approved_at",
					"rejection_reason",
					"created_at",
				],
				ownRequests.map(({ request, ...requested }) => ({
					id: request.id,
					type: request.type,
					status: request.status,
					lifecycle_status: request.lifecycleStatus,
					shift_date: plainDateText(requested.shiftDate),
					shift_start_time: requested.shiftStartTime,
					shift_end_time: requested.shiftEndTime,
					swap_partner: byEmployee(request.targetEmployeeId),
					reason: request.reason,
					reason_category: request.reasonCategory,
					notes: request.notes,
					approver: byEmployee(request.approverId),
					approved_at: instantText(request.approvedAt),
					rejection_reason: request.rejectionReason,
					created_at: instantText(request.createdAt),
				})),
			),
			tablePart(
				"shift_requests_received",
				[
					"id",
					"type",
					"status",
					"lifecycle_status",
					"shift_date",
					"shift_start_time",
					"shift_end_time",
					"requested_by",
					"approver",
					"approved_at",
					"created_at",
				],
				receivedRequests.map((row) => {
					// The shift asked about is the colleague's unless it is the employee's own.
					const ownShift = row.shiftEmployeeId === employeeId;
					return {
						id: row.id,
						type: row.type,
						status: row.status,
						lifecycle_status: row.lifecycleStatus,
						shift_date: ownShift ? plainDateText(row.shiftDate) : null,
						shift_start_time: ownShift ? row.shiftStartTime : null,
						shift_end_time: ownShift ? row.shiftEndTime : null,
						requested_by: byEmployee(row.requesterId),
						approver: byEmployee(row.approverId),
						approved_at: instantText(row.approvedAt),
						created_at: instantText(row.createdAt),
					};
				}),
			),
		],
	};
}
