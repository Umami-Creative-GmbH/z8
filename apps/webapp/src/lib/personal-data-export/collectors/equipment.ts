import { and, asc, eq, exists, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { member, user } from "@/db/auth-schema";
import {
	employee,
	employeeDeactivation,
	employeeDeparture,
	employeeEmploymentPeriod,
} from "@/db/schema";
import {
	equipmentAssignment,
	equipmentCaseHoldEvent,
	equipmentCorrection,
	equipmentException,
	equipmentHandover,
	equipmentItem,
	equipmentType,
} from "@/db/schema/equipment";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import {
	effectiveException,
	effectiveHandover,
} from "@/lib/organization/equipment/corrections";
import { effectiveEquipmentDeadline } from "@/lib/organization/equipment/deadlines";
import { type PersonalDataCollector, tablePart } from "../collector";
import { instantText, jsonText, loadSubjectEmployee } from "../values";
import { equipmentFieldGuide } from "./equipment-fields";

/** The existing request/build/download pipeline owns access, including former subjects.
 * Start only at retained personal assignments, never at item custody or actor activity.
 * One read snapshot prevents retention or a concurrent amendment splitting the evidence.
 */
export const equipmentCollector: PersonalDataCollector = {
	category: "equipment",
	fields: equipmentFieldGuide,
	collect(database, scope) {
		return database.transaction(
			async (tx) => {
				await loadSubjectEmployee(tx, scope);
				const { organizationId, employeeId } = scope;
				const subject = and(
					eq(equipmentAssignment.organizationId, organizationId),
					eq(equipmentAssignment.employeeId, employeeId),
				);
				const assignmentJoin = (assignmentId: AnyPgColumn, org: AnyPgColumn) =>
					and(
						eq(equipmentAssignment.id, assignmentId),
						eq(equipmentAssignment.organizationId, org),
						subject,
					);
				// Display names only, and only actors attached to this subject's scoped evidence.
				// A foreign actor reference must not become a global user-profile lookup.
				const actorJoin = (actorId: AnyPgColumn) =>
					and(
						eq(user.id, actorId),
						or(
							exists(
								tx
									.select({ id: employee.id })
									.from(employee)
									.where(
										and(
											eq(employee.organizationId, organizationId),
											eq(employee.userId, user.id),
										),
									),
							),
							exists(
								tx
									.select({ id: member.id })
									.from(member)
									.where(
										and(
											eq(member.organizationId, organizationId),
											eq(member.userId, user.id),
										),
									),
							),
						),
					);
				const actor = {
					name: user.name,
					firstName: user.firstName,
					lastName: user.lastName,
				};
				const by = (
					value: {
						name: string | null;
						firstName: string | null;
						lastName: string | null;
					} | null,
				) => (value ? buildAuthUserDisplayName(value) || null : null);
				const assignments = await tx
					.select({
						assignment: equipmentAssignment,
						type: {
							name: equipmentType.name,
							mode: equipmentType.trackingMode,
						},
						item: {
							identifier: equipmentItem.identifier,
							serial: equipmentItem.serialNumber,
						},
						period: {
							status: employeeEmploymentPeriod.status,
							startedAt: employeeEmploymentPeriod.startedAt,
							endedAt: employeeEmploymentPeriod.endedAt,
						},
						departure: {
							mode: employeeDeparture.mode,
							status: employeeDeparture.status,
							day: employeeDeparture.lastWorkingDay,
							timezone: employeeDeparture.timezone,
							cutoff: employeeDeparture.cutoffAt,
						},
						ending: {
							at: employeeDeactivation.deactivatedAt,
							// Read only the captured zone, never the plan's unrelated personal details.
							timezone: sql<
								string | null
							>`${employeeDeactivation.plan}->>'timeZone'`,
							reactivatedAt: employeeDeactivation.reactivatedAt,
						},
					})
					.from(equipmentAssignment)
					.innerJoin(
						equipmentType,
						and(
							eq(equipmentType.id, equipmentAssignment.typeId),
							eq(equipmentType.organizationId, organizationId),
						),
					)
					.leftJoin(
						equipmentItem,
						and(
							eq(equipmentItem.id, equipmentAssignment.itemId),
							eq(equipmentItem.organizationId, organizationId),
						),
					)
					.leftJoin(
						employeeEmploymentPeriod,
						and(
							eq(
								employeeEmploymentPeriod.id,
								equipmentAssignment.employmentPeriodId,
							),
							eq(employeeEmploymentPeriod.organizationId, organizationId),
							eq(employeeEmploymentPeriod.employeeId, employeeId),
						),
					)
					.leftJoin(
						employeeDeparture,
						and(
							eq(employeeDeparture.id, equipmentAssignment.departureId),
							eq(employeeDeparture.organizationId, organizationId),
							eq(employeeDeparture.employeeId, employeeId),
						),
					)
					.leftJoin(
						employeeDeactivation,
						and(
							eq(employeeDeactivation.id, equipmentAssignment.deactivationId),
							eq(employeeDeactivation.organizationId, organizationId),
							eq(employeeDeactivation.employeeId, employeeId),
						),
					)
					.where(subject)
					.orderBy(asc(equipmentAssignment.id));
				// One PostgreSQL transaction connection: execute its reads sequentially.
				const handovers = await tx
					.select({ record: equipmentHandover, actor })
					.from(equipmentHandover)
					.innerJoin(
						equipmentAssignment,
						assignmentJoin(
							equipmentHandover.assignmentId,
							equipmentHandover.organizationId,
						),
					)
					.leftJoin(user, actorJoin(equipmentHandover.actorId))
					.where(
						and(subject, eq(equipmentHandover.organizationId, organizationId)),
					)
					.orderBy(asc(equipmentHandover.sequence));
				const exceptions = await tx
					.select({ record: equipmentException, actor })
					.from(equipmentException)
					.innerJoin(
						equipmentAssignment,
						assignmentJoin(
							equipmentException.assignmentId,
							equipmentException.organizationId,
						),
					)
					.leftJoin(user, actorJoin(equipmentException.actorId))
					.where(
						and(subject, eq(equipmentException.organizationId, organizationId)),
					)
					.orderBy(
						asc(equipmentException.recordedAt),
						asc(equipmentException.id),
					);
				const corrections = await tx
					.select({ record: equipmentCorrection, actor })
					.from(equipmentCorrection)
					.innerJoin(
						equipmentAssignment,
						assignmentJoin(
							equipmentCorrection.assignmentId,
							equipmentCorrection.organizationId,
						),
					)
					.leftJoin(user, actorJoin(equipmentCorrection.actorId))
					.where(
						and(
							subject,
							eq(equipmentCorrection.organizationId, organizationId),
						),
					)
					.orderBy(
						asc(equipmentCorrection.recordedAt),
						asc(equipmentCorrection.id),
					);
				const holds = await tx
					.select({ record: equipmentCaseHoldEvent, actor })
					.from(equipmentCaseHoldEvent)
					.innerJoin(
						equipmentAssignment,
						assignmentJoin(
							equipmentCaseHoldEvent.assignmentId,
							equipmentCaseHoldEvent.organizationId,
						),
					)
					.leftJoin(user, actorJoin(equipmentCaseHoldEvent.actorId))
					.where(
						and(
							subject,
							eq(equipmentCaseHoldEvent.organizationId, organizationId),
						),
					)
					.orderBy(
						asc(equipmentCaseHoldEvent.recordedAt),
						asc(equipmentCaseHoldEvent.id),
					);
				return {
					category: "equipment" as const,
					parts: [
						tablePart(
							"case_holds",
							[
								"id",
								"assignment_id",
								"kind",
								"reason",
								"revision",
								"recorded_by",
								"recorded_at",
							],
							holds.map(({ record: r, actor }) => ({
								id: r.id,
								assignment_id: r.assignmentId,
								kind: r.kind,
								reason: r.reason,
								revision: r.revision,
								recorded_by: by(actor),
								recorded_at: instantText(r.recordedAt),
							})),
						),
						tablePart(
							"assignments",
							[
								"id",
								"type",
								"tracking_mode",
								"identifier",
								"serial_number",
								"quantity",
								"return_required",
								"physically_received_quantity",
								"lost_quantity",
								"waived_quantity",
								"exception_received_quantity",
								"outstanding_quantity",
								"explicit_deadline",
								"departure_deadline",
								"effective_deadline",
								"employment_period_id",
								"period_status",
								"period_started_at",
								"period_ended_at",
								"departure_id",
								"departure_mode",
								"departure_status",
								"last_working_day",
								"departure_timezone",
								"departure_cutoff_at",
								"deactivation_id",
								"deactivated_at",
								"deactivation_timezone",
								"reactivated_at",
							],
							assignments.map(
								({ assignment: a, type, item, period, departure, ending }) => ({
									id: a.id,
									type: type.name,
									tracking_mode: type.mode,
									identifier: item?.identifier ?? null,
									serial_number: item?.serial ?? null,
									quantity: a.quantity,
									return_required: a.returnRequired,
									physically_received_quantity: a.receivedQuantity,
									lost_quantity: a.lostQuantity,
									waived_quantity: a.waivedQuantity,
									exception_received_quantity: a.exceptionReceivedQuantity,
									outstanding_quantity: a.returnRequired
										? a.quantity -
											a.receivedQuantity -
											a.lostQuantity -
											a.waivedQuantity +
											a.exceptionReceivedQuantity
										: 0,
									explicit_deadline: a.explicitDeadline,
									departure_deadline: a.departureDeadline,
									effective_deadline: effectiveEquipmentDeadline(
										a.explicitDeadline,
										a.departureDeadline,
									),
									employment_period_id: a.employmentPeriodId,
									period_status: period?.status ?? null,
									period_started_at: instantText(period?.startedAt),
									period_ended_at: instantText(period?.endedAt),
									departure_id: a.departureId,
									departure_mode: departure?.mode ?? null,
									departure_status: departure?.status ?? null,
									last_working_day: departure?.day ?? null,
									departure_timezone: departure?.timezone ?? null,
									departure_cutoff_at: instantText(departure?.cutoff),
									deactivation_id: a.deactivationId,
									deactivated_at: instantText(ending?.at),
									deactivation_timezone: ending?.timezone ?? null,
									reactivated_at: instantText(ending?.reactivatedAt),
								}),
							),
						),
						tablePart(
							"handovers",
							[
								"id",
								"assignment_id",
								"exception_id",
								"kind",
								"historical",
								"quantity",
								"actual_date",
								"condition",
								"notes",
								"effective_quantity",
								"effective_actual_date",
								"effective_condition",
								"effective_notes",
								"recorded_by",
								"recorded_at",
							],
							handovers.map(({ record: r, actor }) => {
								const e = effectiveHandover(r);
								return {
									id: r.id,
									assignment_id: r.assignmentId,
									exception_id: r.exceptionId,
									kind: r.kind,
									historical: r.historical,
									quantity: r.quantity,
									actual_date: r.actualDate,
									condition: r.condition,
									notes: r.notes,
									effective_quantity: e.quantity,
									effective_actual_date: e.actualDate,
									effective_condition: e.condition,
									effective_notes: e.notes,
									recorded_by: by(actor),
									recorded_at: instantText(r.recordedAt),
								};
							}),
						),
						tablePart(
							"exceptions",
							[
								"id",
								"assignment_id",
								"kind",
								"quantity",
								"reason",
								"effective_kind",
								"effective_quantity",
								"effective_reason",
								"received_quantity",
								"recorded_by",
								"recorded_at",
							],
							exceptions.map(({ record: r, actor }) => {
								const e = effectiveException(r);
								return {
									id: r.id,
									assignment_id: r.assignmentId,
									kind: r.kind,
									quantity: r.quantity,
									reason: r.reason,
									effective_kind: e.kind,
									effective_quantity: e.quantity,
									effective_reason: e.reason,
									received_quantity: r.receivedQuantity,
									recorded_by: by(actor),
									recorded_at: instantText(r.recordedAt),
								};
							}),
						),
						tablePart(
							"corrections",
							[
								"id",
								"assignment_id",
								"handover_id",
								"exception_id",
								"reason",
								"before",
								"after",
								"recorded_by",
								"recorded_at",
							],
							corrections.map(({ record: r, actor }) => ({
								id: r.id,
								assignment_id: r.assignmentId,
								handover_id: r.handoverId,
								exception_id: r.exceptionId,
								reason: r.reason,
								before: jsonText(r.before),
								after: jsonText(r.after),
								recorded_by: by(actor),
								recorded_at: instantText(r.recordedAt),
							})),
						),
					],
				};
			},
			{ isolationLevel: "repeatable read", accessMode: "read only" },
		);
	},
};
