import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { employeeDeactivation, employeeDeparture } from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { type equipmentAccess, equipmentContextScope } from "./access";
import { equipmentDepartureDeadline } from "./deadlines";
import type { EquipmentTransaction } from "./setup";

export type EquipmentEndingContext = {
	id: string;
	employeeId: string;
	employmentPeriodId: string | null;
	startedOn: string | null;
	endedOn: string | null;
	deadline: string | null;
	deactivationId: string | null;
	departureId: string | null;
};
/** Deactivation/reactivation splits a reopened employment period into its real custody contexts. */
export async function readEquipmentEndingContexts(
	tx: EquipmentTransaction,
	organizationId: string,
	employeeId: string,
	period:
		| { id: string; startedAt: Date | null; endedAt: Date | null }
		| undefined,
	timezone: string,
	legacyDeactivatedAt: Date | null = null,
): Promise<EquipmentEndingContext[]> {
	const deactivations = await tx
		.select()
		.from(employeeDeactivation)
		.where(
			and(
				eq(employeeDeactivation.organizationId, organizationId),
				eq(employeeDeactivation.employeeId, employeeId),
				period
					? eq(employeeDeactivation.employmentPeriodId, period.id)
					: isNull(employeeDeactivation.employmentPeriodId),
			),
		)
		.orderBy(asc(employeeDeactivation.deactivatedAt));
	const [departure] = period
		? await tx
				.select()
				.from(employeeDeparture)
				.where(
					and(
						eq(employeeDeparture.organizationId, organizationId),
						eq(employeeDeparture.employeeId, employeeId),
						eq(employeeDeparture.employmentPeriodId, period.id),
						inArray(employeeDeparture.status, [
							"pending",
							"blocked",
							"effective",
						]),
					),
				)
		: [];
	const day = (at: Date, zone = timezone) =>
		instantFromDate(at).toZonedDateTimeISO(zone).toPlainDate().toString();
	const result: EquipmentEndingContext[] = [];
	let startedOn = period?.startedAt ? day(period.startedAt) : null;
	for (const d of deactivations) {
		const zone =
			typeof d.plan?.timeZone === "string" ? d.plan.timeZone : timezone;
		result.push({
			id: d.id,
			employeeId,
			employmentPeriodId: period?.id ?? null,
			startedOn,
			endedOn: day(d.deactivatedAt, zone),
			deadline: equipmentDepartureDeadline(
				instantFromDate(d.deactivatedAt),
				zone,
				"immediate",
			),
			deactivationId: d.id,
			departureId: null,
		});
		if (!d.reactivatedAt) return result;
		startedOn = day(d.reactivatedAt);
	}
	result.push({
		id: "current",
		employeeId,
		employmentPeriodId: period?.id ?? null,
		startedOn,
		endedOn: departure
			? equipmentDepartureDeadline(
					instantFromDate(departure.cutoffAt),
					departure.timezone,
					departure.mode,
				)
			: period?.endedAt
				? day(period.endedAt)
				: legacyDeactivatedAt
					? day(legacyDeactivatedAt)
					: null,
		deadline: departure
			? equipmentDepartureDeadline(
					instantFromDate(departure.cutoffAt),
					departure.timezone,
					departure.mode,
				)
			: legacyDeactivatedAt
				? equipmentDepartureDeadline(
						instantFromDate(legacyDeactivatedAt),
						timezone,
						"immediate",
					)
				: null,
		deactivationId: null,
		departureId: departure?.id ?? null,
	});
	return result;
}
export async function equipmentCoversContext(
	tx: EquipmentTransaction,
	organizationId: string,
	access: Awaited<ReturnType<typeof equipmentAccess>>,
	context: EquipmentEndingContext,
) {
	const result = await tx.execute(
		sql`select 1 where ${equipmentContextScope(access, { organizationId: sql`${organizationId}`, employeeId: sql`${context.employeeId}::uuid`, periodId: sql`${context.employmentPeriodId}::uuid`, deactivationId: sql`${context.deactivationId}::uuid`, departureId: sql`${context.departureId}::uuid` })}`,
	);
	return !!result.rows.length;
}
