import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db as database } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	employee,
	employeeDeparture,
	employeeEmploymentPeriod,
} from "@/db/schema";
import {
	equipmentAssignment,
	equipmentCommand,
	equipmentHandover,
	equipmentItem,
	equipmentPolicy,
	equipmentType,
} from "@/db/schema/equipment";
import {
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { AuthorizationError } from "@/lib/effect/errors";
import {
	employeeHasOrganizationAccess,
	resolveEmployeeOrganizationAccess,
} from "@/lib/employee-lifecycle/access";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import {
	type EquipmentAssignmentView,
	type EquipmentFilters,
	type EquipmentHandoverView,
	type EquipmentOutcome,
	type EquipmentView,
	equipmentChangeSchema,
} from "./contracts";
import {
	effectiveEquipmentDeadline,
	equipmentDepartureDeadline,
} from "./deadlines";
import { applyItemReadiness, readItemReadiness } from "./readiness";
import {
	type EquipmentTransaction,
	prepareEquipmentTypeForIssuance,
} from "./setup";

const scoped = (organizationId: string, id: string) =>
	and(
		eq(equipmentItem.organizationId, organizationId),
		eq(equipmentItem.id, id),
	);
const assignmentScope = (organizationId: string, id: string) =>
	and(
		eq(equipmentAssignment.organizationId, organizationId),
		eq(equipmentAssignment.id, id),
	);

import {
	type EquipmentActor,
	equipmentAccess,
	equipmentCoversEmployee,
	equipmentItemScope,
	equipmentSubjectScope,
	lockEquipmentContext,
} from "./access";

export type { EquipmentActor } from "./access";

async function organizationCalendar(
	tx: EquipmentTransaction,
	organizationId: string,
) {
	const [org] = await tx
		.select({
			timezone: organization.timezone,
			policyOrganizationId: equipmentPolicy.organizationId,
		})
		.from(organization)
		.leftJoin(
			equipmentPolicy,
			eq(equipmentPolicy.organizationId, organization.id),
		)
		.where(eq(organization.id, organizationId));
	const timezone = resolveOrganizationTimezone(org?.timezone).timezone;
	const now = systemClock.nowInstant();
	return {
		timezone,
		now,
		policyConfigured: !!org?.policyOrganizationId,
		today: now.toZonedDateTimeISO(timezone).toPlainDate(),
	};
}

/** The command boundary owns authorization, replay, chronology and all writes together. */
export async function applyEquipmentChange(
	db: typeof database,
	actor: EquipmentActor,
	input: unknown,
): Promise<EquipmentOutcome> {
	const parsed = equipmentChangeSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid_input" };
	const change = parsed.data;
	const fingerprint = createHash("sha256")
		.update(JSON.stringify({ actor: actor.userId, change }))
		.digest("hex");
	return db.transaction(async (tx): Promise<EquipmentOutcome> => {
		// Route before locks, then confirm under them. Employee user identity must not drift.
		const [target] =
			change.kind === "issue_individual" ||
			change.kind === "issue_quantity" ||
			change.kind === "register_and_issue_individual"
				? await tx
						.select({ id: employee.id, userId: employee.userId })
						.from(employee)
						.where(
							and(
								eq(employee.organizationId, actor.organizationId),
								eq(employee.id, change.employeeId),
							),
						)
				: [];
		await lockEquipmentContext(tx, actor, target);
		const access = await equipmentAccess(tx, actor);
		if (!access.canManage) return { ok: false, reason: "forbidden" };
		if (
			change.kind === "clear_item" ||
			change.kind === "mark_item_unavailable" ||
			change.kind === "retire_item"
		) {
			const [covered] = await tx
				.select({ id: equipmentItem.id })
				.from(equipmentItem)
				.where(
					and(
						scoped(actor.organizationId, change.itemId),
						equipmentItemScope(access),
					),
				);
			if (!covered)
				return { ok: false, reason: access.all ? "not_found" : "forbidden" };
		} else {
			const subjectId =
				change.kind !== "receive_individual" &&
				change.kind !== "receive_quantity"
					? change.employeeId
					: (
							await tx
								.select({ employeeId: equipmentAssignment.employeeId })
								.from(equipmentAssignment)
								.where(
									assignmentScope(actor.organizationId, change.assignmentId),
								)
						)[0]?.employeeId;
			if (
				!subjectId ||
				!(await equipmentCoversEmployee(tx, actor, access, subjectId))
			)
				return {
					ok: false,
					reason: access.canAdminister ? "not_found" : "forbidden",
				};
		}
		const [replay] = await tx
			.select()
			.from(equipmentCommand)
			.where(
				and(
					eq(equipmentCommand.organizationId, actor.organizationId),
					eq(equipmentCommand.requestId, change.requestId),
				),
			);
		if (replay)
			return replay.fingerprint === fingerprint
				? replay.result
				: { ok: false, reason: "request_conflict" };
		const { today, now } = await organizationCalendar(tx, actor.organizationId);
		if (
			change.kind === "clear_item" ||
			change.kind === "mark_item_unavailable" ||
			change.kind === "retire_item"
		) {
			const outcome = await applyItemReadiness(
				tx,
				actor,
				change,
				dateFromInstant(now),
			);
			if (outcome.ok)
				await tx.insert(equipmentCommand).values({
					organizationId: actor.organizationId,
					requestId: change.requestId,
					fingerprint,
					result: outcome,
				});
			return outcome;
		}
		const actualDate = parsePlainDate(change.actualDate);
		if (Temporal.PlainDate.compare(actualDate, today) > 0)
			return { ok: false, reason: "future_date" };
		const recordedAt = dateFromInstant(now);
		let result: { id: string; revision: number };
		if (
			change.kind === "issue_individual" ||
			change.kind === "issue_quantity" ||
			change.kind === "register_and_issue_individual"
		) {
			if (!change.returnRequired && change.explicitDeadline)
				return { ok: false, reason: "invalid_input" };
			if (
				change.explicitDeadline &&
				Temporal.PlainDate.compare(
					parsePlainDate(change.explicitDeadline),
					actualDate,
				) < 0
			)
				return { ok: false, reason: "conflicting_history" };
			const [current] = await tx
				.select({
					userId: employee.userId,
					current: employeeHasOrganizationAccess(now),
				})
				.from(employee)
				.where(
					and(
						eq(employee.organizationId, actor.organizationId),
						eq(employee.id, change.employeeId),
					),
				);
			if (!current || !target || current.userId !== target.userId)
				return { ok: false, reason: "not_found" };
			const employeeAccess = await resolveEmployeeOrganizationAccess(tx, {
				organizationId: actor.organizationId,
				userId: current.userId,
				now,
			});
			if (!current.current || !employeeAccess.allowed)
				return { ok: false, reason: "employee_not_current" };
			let [item] =
				change.kind === "issue_individual"
					? await tx
							.select()
							.from(equipmentItem)
							.where(scoped(actor.organizationId, change.itemId))
					: [];
			if (change.kind === "issue_individual") {
				if (!item) return { ok: false, reason: "not_found" };
				if (item.revision !== change.expectedRevision)
					return { ok: false, reason: "stale_revision" };
				if (item.archivedAt || item.inCustody || item.status !== "available")
					return { ok: false, reason: "item_unavailable" };
				if (
					item.lastHandoverDate &&
					Temporal.PlainDate.compare(
						actualDate,
						parsePlainDate(item.lastHandoverDate),
					) < 0
				)
					return { ok: false, reason: "conflicting_history" };
			}
			const typeId =
				change.kind === "issue_quantity" ||
				change.kind === "register_and_issue_individual"
					? change.typeId
					: item?.typeId;
			if (!typeId) return { ok: false, reason: "not_found" };
			const [type] = await tx
				.select()
				.from(equipmentType)
				.where(
					and(
						eq(equipmentType.organizationId, actor.organizationId),
						eq(equipmentType.id, typeId),
					),
				);
			if (!type) return { ok: false, reason: "not_found" };
			if (
				change.kind === "issue_quantity" &&
				type.revision !== change.expectedRevision
			)
				return { ok: false, reason: "stale_revision" };
			if (
				type.trackingMode !==
				(change.kind === "issue_quantity" ? "quantity" : "individual")
			)
				return {
					ok: false,
					reason:
						change.kind === "issue_quantity"
							? "quantity_required"
							: "individual_required",
				};
			if (change.kind === "register_and_issue_individual") {
				const [duplicate] = await tx
					.select({ id: equipmentItem.id })
					.from(equipmentItem)
					.where(
						and(
							eq(equipmentItem.organizationId, actor.organizationId),
							sql`${equipmentItem.identifierKey} = lower(regexp_replace(${change.identifier}, '^[[:space:]]+|[[:space:]]+$', '', 'g'))`,
						),
					);
				if (duplicate) return { ok: false, reason: "identifier_taken" };
			}
			const prepared = await prepareEquipmentTypeForIssuance(tx, {
				organizationId: actor.organizationId,
				typeId,
			});
			if (!prepared.ok) return prepared;
			if (change.kind === "register_and_issue_individual") {
				[item] = await tx
					.insert(equipmentItem)
					.values({
						organizationId: actor.organizationId,
						typeId,
						identifier: change.identifier,
						serialNumber: change.serialNumber || null,
						createdBy: actor.userId,
						updatedBy: actor.userId,
						createdAt: recordedAt,
						updatedAt: recordedAt,
					})
					.returning();
			}
			const quantity = change.kind === "issue_quantity" ? change.quantity : 1;
			const [period] = await tx
				.select({ id: employeeEmploymentPeriod.id })
				.from(employeeEmploymentPeriod)
				.where(
					and(
						eq(employeeEmploymentPeriod.organizationId, actor.organizationId),
						eq(employeeEmploymentPeriod.employeeId, change.employeeId),
						eq(employeeEmploymentPeriod.status, "open"),
					),
				);
			const [departure] = period
				? await tx
						.select()
						.from(employeeDeparture)
						.where(
							and(
								eq(employeeDeparture.organizationId, actor.organizationId),
								eq(employeeDeparture.employeeId, change.employeeId),
								eq(employeeDeparture.employmentPeriodId, period.id),
								eq(employeeDeparture.status, "pending"),
							),
						)
				: [];
			const [assignment] = await tx
				.insert(equipmentAssignment)
				.values({
					organizationId: actor.organizationId,
					itemId: item?.id ?? null,
					typeId,
					quantity,
					employeeId: change.employeeId,
					employmentPeriodId: period?.id ?? null,
					returnRequired: change.returnRequired,
					explicitDeadline: change.explicitDeadline ?? null,
					departureDeadline:
						change.returnRequired && departure
							? equipmentDepartureDeadline(
									instantFromDate(departure.cutoffAt),
									departure.timezone,
									departure.mode,
								)
							: null,
					departureId: change.returnRequired ? (departure?.id ?? null) : null,
				})
				.returning();
			await tx.insert(equipmentHandover).values({
				organizationId: actor.organizationId,
				assignmentId: assignment.id,
				kind: "issue",
				quantity,
				actualDate: change.actualDate,
				condition: change.condition,
				notes: change.notes || null,
				actorId: actor.userId,
				recordedAt,
			});
			if (item)
				await tx
					.update(equipmentItem)
					.set({
						inCustody: true,
						lastHandoverDate: change.actualDate,
						revision: item.revision + 1,
						updatedBy: actor.userId,
						updatedAt: recordedAt,
					})
					.where(scoped(actor.organizationId, item.id));
			result = assignment;
		} else {
			const [assignment] = await tx
				.select()
				.from(equipmentAssignment)
				.where(assignmentScope(actor.organizationId, change.assignmentId));
			if (!assignment) return { ok: false, reason: "not_found" };
			if (
				(change.kind === "receive_individual") !==
				(assignment.itemId !== null)
			)
				return {
					ok: false,
					reason: assignment.itemId
						? "individual_required"
						: "quantity_required",
				};
			const [holder] = await tx
				.select({ userId: employee.userId })
				.from(employee)
				.where(
					and(
						eq(employee.organizationId, actor.organizationId),
						eq(
							employee.id,
							assignment.employeeId ?? "00000000-0000-0000-0000-000000000000",
						),
					),
				);
			if (holder?.userId === actor.userId)
				return { ok: false, reason: "self_receipt" };
			if (assignment.revision !== change.expectedRevision)
				return { ok: false, reason: "stale_revision" };
			if (assignment.received) return { ok: false, reason: "already_received" };
			const quantity = change.kind === "receive_quantity" ? change.quantity : 1;
			const receivedQuantity = assignment.receivedQuantity + quantity;
			if (receivedQuantity > assignment.quantity)
				return { ok: false, reason: "excess_quantity" };
			const [issue] = await tx
				.select()
				.from(equipmentHandover)
				.where(
					and(
						eq(equipmentHandover.organizationId, actor.organizationId),
						eq(equipmentHandover.assignmentId, assignment.id),
						eq(equipmentHandover.kind, "issue"),
					),
				);
			if (
				!issue ||
				Temporal.PlainDate.compare(
					actualDate,
					parsePlainDate(issue.actualDate),
				) < 0
			)
				return { ok: false, reason: "conflicting_history" };
			const [item] = assignment.itemId
				? await tx
						.select()
						.from(equipmentItem)
						.where(scoped(actor.organizationId, assignment.itemId))
				: [];
			if (assignment.itemId && !item?.inCustody)
				return { ok: false, reason: "item_unavailable" };
			await tx.insert(equipmentHandover).values({
				organizationId: actor.organizationId,
				assignmentId: assignment.id,
				kind: "receipt",
				quantity,
				actualDate: change.actualDate,
				condition: change.condition,
				notes: change.notes || null,
				actorId: actor.userId,
				recordedAt,
			});
			const [updated] = await tx
				.update(equipmentAssignment)
				.set({
					received: receivedQuantity === assignment.quantity,
					receivedQuantity,
					revision: assignment.revision + 1,
				})
				.where(assignmentScope(actor.organizationId, assignment.id))
				.returning();
			if (item)
				await tx
					.update(equipmentItem)
					.set({
						inCustody: false,
						lastHandoverDate: change.actualDate,
						status:
							change.condition === "damaged" && item.status !== "retired"
								? "unavailable"
								: item.status,
						revision: item.revision + 1,
						updatedBy: actor.userId,
						updatedAt: recordedAt,
					})
					.where(scoped(actor.organizationId, item.id));
			result = updated;
		}
		const outcome = {
			ok: true,
			id: result.id,
			revision: result.revision,
		} as const;
		await tx.insert(equipmentCommand).values({
			organizationId: actor.organizationId,
			requestId: change.requestId,
			fingerprint,
			result: outcome,
		});
		return outcome;
	});
}

/** Staff overview, scoped employee history and self history share one permission/read model. */
export async function readEquipment(
	db: typeof database,
	actor: EquipmentActor,
	scope:
		| { kind: "overview"; filters: EquipmentFilters }
		| { kind: "employee"; employeeId: string }
		| { kind: "personal" },
): Promise<EquipmentView> {
	return db.transaction(async (tx) => {
		await lockEquipmentContext(tx, actor);
		const access = await equipmentAccess(tx, actor);
		const employeeId =
			scope.kind === "personal"
				? access.employeeId
				: scope.kind === "employee"
					? scope.employeeId
					: undefined;
		const coversSubject = employeeId
			? access.canManage &&
				(await equipmentCoversEmployee(tx, actor, access, employeeId))
			: false;
		if (
			(scope.kind === "overview" && !access.canManage) ||
			(scope.kind === "employee" &&
				!access.canAdminister &&
				!coversSubject &&
				employeeId !== access.employeeId) ||
			(scope.kind === "overview" &&
				!access.canAdminister &&
				scope.filters.holderId &&
				!(await equipmentCoversEmployee(
					tx,
					actor,
					access,
					scope.filters.holderId,
				)))
		)
			throw new AuthorizationError({
				message: "You cannot read these equipment records.",
				resource: "equipment",
				action: "read",
			});
		const calendar = await organizationCalendar(tx, actor.organizationId);
		const { timezone, today, policyConfigured } = calendar;
		const staffView =
			scope.kind !== "personal" &&
			(scope.kind === "overview" ? access.canManage : coversSubject);
		const employees = await tx
			.select({
				id: employee.id,
				userId: employee.userId,
				firstName: employee.firstName,
				lastName: employee.lastName,
				name: user.name,
				current: employeeHasOrganizationAccess(calendar.now),
			})
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, actor.organizationId),
					staffView
						? equipmentSubjectScope(access)
						: eq(
								employee.id,
								employeeId ?? "00000000-0000-0000-0000-000000000000",
							),
				),
			)
			.orderBy(asc(user.name), asc(employee.id));
		const employeeMap = new Map(
			employees.map((e) => [
				e.id,
				{
					id: e.id,
					userId: e.userId,
					name: [e.firstName, e.lastName].filter(Boolean).join(" ") || e.name,
					former: !e.current,
				},
			]),
		);
		const rows =
			employeeId === null
				? []
				: await tx
						.select({
							assignment: equipmentAssignment,
							item: equipmentItem,
							type: equipmentType,
						})
						.from(equipmentAssignment)
						.leftJoin(
							equipmentItem,
							and(
								eq(equipmentItem.id, equipmentAssignment.itemId),
								eq(
									equipmentItem.organizationId,
									equipmentAssignment.organizationId,
								),
							),
						)
						.innerJoin(
							equipmentType,
							and(
								eq(equipmentType.id, equipmentAssignment.typeId),
								eq(
									equipmentType.organizationId,
									equipmentAssignment.organizationId,
								),
							),
						)
						.where(
							and(
								eq(equipmentAssignment.organizationId, actor.organizationId),
								inArray(equipmentAssignment.employeeId, [
									...employeeMap.keys(),
								]),
								employeeId
									? eq(equipmentAssignment.employeeId, employeeId)
									: undefined,
							),
						)
						.orderBy(
							asc(equipmentItem.identifier),
							asc(equipmentAssignment.id),
						);
		const handovers = rows.length
			? await tx
					.select({ record: equipmentHandover, actorName: user.name })
					.from(equipmentHandover)
					.leftJoin(user, eq(user.id, equipmentHandover.actorId))
					.where(
						and(
							eq(equipmentHandover.organizationId, actor.organizationId),
							inArray(
								equipmentHandover.assignmentId,
								rows.map((r) => r.assignment.id),
							),
						),
					)
					.orderBy(
						asc(equipmentHandover.actualDate),
						asc(equipmentHandover.recordedAt),
						asc(equipmentHandover.id),
					)
			: [];
		const evidence = new Map<string, EquipmentHandoverView[]>();
		for (const { record, actorName } of handovers) {
			const key = `${record.assignmentId}:${record.kind}`;
			const records = evidence.get(key) ?? [];
			records.push({
				id: record.id,
				quantity: record.quantity,
				actualDate: record.actualDate,
				condition: record.condition,
				notes: record.notes,
				actorId: record.actorId,
				actorName,
				recordedAt: instantFromDate(record.recordedAt).toString(),
			});
			evidence.set(key, records);
		}
		const filters = scope.kind === "overview" ? scope.filters : {};
		const assignments: EquipmentAssignmentView[] = [];
		for (const { assignment, item, type } of rows) {
			const holder = employeeMap.get(assignment.employeeId ?? "");
			const issue = evidence.get(`${assignment.id}:issue`)?.[0];
			const receipts = evidence.get(`${assignment.id}:receipt`) ?? [];
			if (!holder || !issue) continue;
			// Physical receipts alone reduce this slice's return balance. Later exception
			// outcomes must reduce obligations separately, never receivedQuantity.
			const outstandingQuantity = assignment.returnRequired
				? assignment.quantity - assignment.receivedQuantity
				: 0;
			const outstanding = outstandingQuantity > 0;
			const effectiveDeadline = effectiveEquipmentDeadline(
				assignment.explicitDeadline,
				assignment.departureDeadline,
			);
			const overdue =
				outstanding &&
				!!effectiveDeadline &&
				Temporal.PlainDate.compare(parsePlainDate(effectiveDeadline), today) <
					0;
			if (
				(filters.holderId && holder.id !== filters.holderId) ||
				(filters.typeId && type.id !== filters.typeId) ||
				(filters.outstanding !== undefined &&
					filters.outstanding !== outstanding) ||
				(filters.overdue !== undefined && filters.overdue !== overdue) ||
				(filters.former !== undefined && filters.former !== holder.former)
			)
				continue;
			assignments.push({
				id: assignment.id,
				itemId: item?.id ?? null,
				trackingMode: type.trackingMode,
				quantity: assignment.quantity,
				physicallyReceivedQuantity: assignment.receivedQuantity,
				outstandingQuantity,
				typeId: type.id,
				typeName: type.name,
				identifier: item?.identifier ?? type.name,
				employeeId: holder.id,
				holderName: holder.name,
				former: holder.former,
				returnRequired: assignment.returnRequired,
				explicitDeadline: assignment.explicitDeadline,
				departureDeadline: assignment.departureDeadline,
				effectiveDeadline,
				employmentPeriodId: assignment.employmentPeriodId,
				departureId: assignment.departureId,
				outstanding,
				overdue,
				held: !assignment.received,
				revision: assignment.revision,
				canReceive:
					staffView && !assignment.received && holder.userId !== actor.userId,
				issue,
				receipt: receipts.at(-1) ?? null,
				receipts,
			});
		}
		const types = staffView
			? await tx
					.select({ id: equipmentType.id, name: equipmentType.name })
					.from(equipmentType)
					.where(eq(equipmentType.organizationId, actor.organizationId))
					.orderBy(asc(equipmentType.name))
			: [];
		const availableItems =
			staffView && policyConfigured
				? await tx
						.select({
							id: equipmentItem.id,
							identifier: equipmentItem.identifier,
							typeId: equipmentType.id,
							typeName: equipmentType.name,
							defaultReturnRequired: equipmentType.defaultReturnRequired,
							revision: equipmentItem.revision,
						})
						.from(equipmentItem)
						.innerJoin(
							equipmentType,
							and(
								eq(equipmentType.id, equipmentItem.typeId),
								eq(equipmentType.organizationId, equipmentItem.organizationId),
							),
						)
						.where(
							and(
								eq(equipmentItem.organizationId, actor.organizationId),
								eq(equipmentItem.inCustody, false),
								eq(equipmentItem.status, "available"),
								sql`${equipmentItem.archivedAt} is null`,
								sql`${equipmentType.archivedAt} is null`,
								eq(equipmentType.trackingMode, "individual"),
							),
						)
						.orderBy(asc(equipmentItem.identifier))
				: [];
		const availableQuantityTypes =
			staffView && policyConfigured
				? await tx
						.select({
							id: equipmentType.id,
							name: equipmentType.name,
							defaultReturnRequired: equipmentType.defaultReturnRequired,
							revision: equipmentType.revision,
						})
						.from(equipmentType)
						.where(
							and(
								eq(equipmentType.organizationId, actor.organizationId),
								eq(equipmentType.trackingMode, "quantity"),
								sql`${equipmentType.archivedAt} is null`,
							),
						)
						.orderBy(asc(equipmentType.name), asc(equipmentType.id))
				: [];
		return {
			readinessItems: staffView
				? await readItemReadiness(
						tx,
						actor.organizationId,
						equipmentItemScope(access),
					)
				: [],
			availableQuantityTypes,
			canManage: staffView,
			canAdminister: access.canAdminister && scope.kind !== "personal",
			registrationTypes:
				staffView && policyConfigured
					? await tx
							.select({
								id: equipmentType.id,
								name: equipmentType.name,
								defaultReturnRequired: equipmentType.defaultReturnRequired,
							})
							.from(equipmentType)
							.where(
								and(
									eq(equipmentType.organizationId, actor.organizationId),
									eq(equipmentType.trackingMode, "individual"),
									sql`${equipmentType.archivedAt} is null`,
								),
							)
							.orderBy(asc(equipmentType.name))
					: [],
			policyConfigured,
			timezone,
			today: today.toString(),
			assignments,
			availableItems,
			employees: staffView
				? [...employeeMap.values()].map(({ id, name, former }) => ({
						id,
						name,
						former,
					}))
				: [],
			types,
		};
	});
}
