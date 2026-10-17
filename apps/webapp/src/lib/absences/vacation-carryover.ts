import "server-only";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	auditLog,
	employee,
	employeeVacationAllowance,
	vacationCarryoverTransfer,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import type { VacationBalanceConfiguration } from "./types";
import type {
	CarryoverResult,
	CarryoverSummary,
	ExpiryResult,
} from "./vacation.service";
import { loadVacationBalances } from "./vacation-balance-store";
import { calculateCarryoverDays } from "./vacation-calculator";
import { carryoverExpiryInstant } from "./vacation-carryover-terms";
import type { VacationPolicyResolution } from "./vacation-policy-history";
import { loadEmployeeVacationPolicy } from "./vacation-policy-history";
import { vacationPolicyCalculationsEnabled } from "./vacation-policy-rollout";
import { loadCompanyDefaultVacationPolicy } from "./vacation-policy-store";

const logger = createLogger("vacation-carryover");
class CarryoverConfigurationError extends Error {
	constructor(
		message: string,
		readonly configuration: VacationBalanceConfiguration,
	) {
		super(message);
	}
}

function boundaryConfiguration(
	resolution: VacationPolicyResolution,
	date: string,
): VacationBalanceConfiguration {
	return resolution.status === "conflict"
		? {
				status: "conflict",
				periods: [
					{
						startDate: date,
						endDate: date,
						policyIds: resolution.policyIds,
						reason: resolution.reason,
					},
				],
			}
		: { status: "missing", periods: [{ startDate: date, endDate: date }] };
}

/** A retry observes a committed decision before resolving mutable policy or usage again. */
export async function commitAnnualVacationCarryover(
	organizationId: string,
	fromYear: number,
	performedBy: string,
	timezone: string,
): Promise<CarryoverSummary> {
	const toYear = fromYear + 1;
	const results: CarryoverResult[] = [];
	const errors: CarryoverSummary["errors"] = [];
	const [employees, actor] = await Promise.all([
		db
			.select({ id: employee.id, userId: employee.userId, name: user.name })
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
			),
		db.query.user.findFirst({
			where: eq(user.id, performedBy),
			columns: { id: true },
		}),
	]);
	for (const person of employees) {
		try {
			const result = await db.transaction(async (tx) => {
				await tx.execute(
					sql`select pg_advisory_xact_lock(hashtextextended(${`vacation-policy:${organizationId}`},0))`,
				);
				const [target] = await tx
					.select({ id: employee.id })
					.from(employee)
					.where(
						and(
							eq(employee.organizationId, organizationId),
							eq(employee.id, person.id),
						),
					)
					.for("update");
				if (!target) return;
				const prior = await tx.query.vacationCarryoverTransfer.findFirst({
					where: and(
						eq(vacationCarryoverTransfer.organizationId, organizationId),
						eq(vacationCarryoverTransfer.employeeId, person.id),
						eq(vacationCarryoverTransfer.sourceYear, fromYear),
					),
				});
				if (prior) return;
				const receiving = await tx.query.employeeVacationAllowance.findMany({
					where: and(
						eq(employeeVacationAllowance.employeeId, person.id),
						eq(employeeVacationAllowance.year, toYear),
					),
					orderBy: [
						desc(employeeVacationAllowance.updatedAt),
						desc(employeeVacationAllowance.id),
					],
				});
				// Never infer terms or replace even a zero-valued existing legacy carryover.
				if (receiving.some((row) => row.customCarryoverDays !== null)) {
					const stored = receiving[0];
					await tx.insert(vacationCarryoverTransfer).values({
						organizationId,
						employeeId: person.id,
						sourceYear: fromYear,
						allowanceId: stored.id,
						outcome: "legacy_preserved",
						performedBy,
						days: stored.customCarryoverDays ?? "0",
						originalDays: stored.customCarryoverDays ?? "0",
						timezone,
					});
					return;
				}
				const currentDate = new Date(
					Temporal.PlainDate.from({ year: fromYear + 1, month: 1, day: 1 })
						.toZonedDateTime(timezone)
						.toInstant()
						.subtract({ milliseconds: 1 }).epochMilliseconds,
				);
				const source = await loadVacationBalances(tx, {
					organizationId,
					employeeIds: [person.id],
					year: fromYear,
					timezone,
					currentDate,
				});
				const configuration = source.configurations.get(person.id);
				const balance = source.balances.get(person.id);
				if (!balance)
					throw new CarryoverConfigurationError(
						`Vacation policy ${configuration?.status ?? "missing"} for source year ${fromYear}; automatic carryover skipped`,
						configuration ?? {
							status: "missing",
							periods: [
								{
									startDate: `${fromYear}-01-01`,
									endDate: `${fromYear}-12-31`,
								},
							],
						},
					);
				const sourceResolution = await loadEmployeeVacationPolicy(tx, {
					organizationId,
					employeeId: person.id,
					date: `${fromYear}-12-31`,
				});
				const sourcePolicy =
					sourceResolution.status === "resolved" ||
					sourceResolution.status === "legacy"
						? sourceResolution.policy
						: undefined;
				if (!sourcePolicy)
					throw new CarryoverConfigurationError(
						`Vacation policy ${sourceResolution.status} on ${fromYear}-12-31; automatic carryover skipped`,
						boundaryConfiguration(sourceResolution, `${fromYear}-12-31`),
					);
				const receivingEnabled = await vacationPolicyCalculationsEnabled(
					tx,
					organizationId,
					toYear,
				);
				const destination = receivingEnabled
					? await loadEmployeeVacationPolicy(tx, {
							organizationId,
							employeeId: person.id,
							date: `${toYear}-01-01`,
						})
					: {
							status: "legacy" as const,
							policy: await loadCompanyDefaultVacationPolicy(tx, {
								organizationId,
								year: toYear,
							}),
						};
				const destinationPolicy =
					destination.status === "resolved" || destination.status === "legacy"
						? destination.policy
						: undefined;
				if (!destinationPolicy)
					throw new CarryoverConfigurationError(
						`Vacation policy ${destination.status} on ${toYear}-01-01; automatic carryover skipped`,
						boundaryConfiguration(destination, `${toYear}-01-01`),
					);
				const calculated = calculateCarryoverDays({
					totalAllowance: balance.totalDays,
					usedDays: balance.usedDays,
					previouslyTakenDays: 0,
					maxCarryoverDays: sourcePolicy.maxCarryoverDays,
				});
				const applied = sourcePolicy.allowCarryover ? calculated.applied : 0;
				const expiryDate = carryoverExpiryInstant(
					toYear,
					destinationPolicy.carryoverExpiryMonths,
					timezone,
				);
				const committedAt = new Date();
				let allowanceId: string | null = null;
				if (applied > 0) {
					if (receiving[0]) {
						allowanceId = receiving[0].id;
						await tx
							.update(employeeVacationAllowance)
							.set({
								customCarryoverDays: String(applied),
								updatedAt: committedAt,
							})
							.where(
								and(
									eq(employeeVacationAllowance.id, allowanceId),
									eq(employeeVacationAllowance.employeeId, person.id),
									eq(employeeVacationAllowance.year, toYear),
								),
							);
					} else {
						const [created] = await tx
							.insert(employeeVacationAllowance)
							.values({
								employeeId: person.id,
								year: toYear,
								customCarryoverDays: String(applied),
								updatedAt: committedAt,
							})
							.returning({ id: employeeVacationAllowance.id });
						allowanceId = created.id;
					}
				}
				await tx.insert(vacationCarryoverTransfer).values({
					organizationId,
					employeeId: person.id,
					sourceYear: fromYear,
					allowanceId,
					outcome: "generated",
					performedBy,
					days: String(applied),
					originalDays: String(applied),
					expiryDate,
					timezone,
					sourcePolicyId: sourcePolicy.id,
					receivingPolicyId: destinationPolicy.id,
					createdAt: committedAt,
				});
				if (actor)
					await tx.insert(auditLog).values({
						organizationId,
						entityId: person.id,
						entityType: "employee",
						employeeId: person.id,
						performedBy: actor.id,
						action: AuditAction.VACATION_CARRYOVER_APPLIED,
						timestamp: committedAt,
						metadata: JSON.stringify({
							source: "annual_carryover",
							performedBy,
							fromYear,
							toYear,
							remaining: calculated.remaining,
							carryoverApplied: applied,
							carryoverCapped: sourcePolicy.allowCarryover && calculated.capped,
							expiryDate: expiryDate?.toISOString() ?? null,
							timezone,
						}),
					});
				return {
					employeeId: person.id,
					employeeName: person.name,
					previousYearRemaining: calculated.remaining,
					carryoverApplied: applied,
					carryoverCapped: sourcePolicy.allowCarryover && calculated.capped,
					expiryDate,
				};
			});
			if (result) {
				results.push(result);
				logger.info(
					{
						organizationId,
						employeeId: person.id,
						performedBy,
						sourceYear: fromYear,
						days: result.carryoverApplied,
					},
					"Vacation carryover committed",
				);
			}
		} catch (error) {
			logger.error(
				{ organizationId, employeeId: person.id, error },
				"Vacation carryover skipped",
			);
			errors.push({
				employeeId: person.id,
				error:
					error instanceof CarryoverConfigurationError
						? error.message
						: "Carryover could not be committed",
				...(error instanceof CarryoverConfigurationError
					? { configuration: error.configuration }
					: {}),
			});
		}
	}
	return {
		organizationId,
		fromYear,
		toYear,
		processedAt: new Date(),
		employeesProcessed: results.length,
		totalDaysCarriedOver: results.reduce(
			(sum, row) => sum + row.carryoverApplied,
			0,
		),
		results,
		errors,
	};
}

/** Frozen expiry is authoritative; legacy rows retain their company-default treatment. */
export async function expireCommittedVacationCarryover(
	organizationId: string,
	performedBy: string,
	currentDate: Date,
	timezone: string,
): Promise<ExpiryResult> {
	const instant = Temporal.Instant.from(currentDate.toISOString());
	const currentYear = instant.toZonedDateTimeISO(timezone).year;
	const [policy, people, actor, dueTransfers] = await Promise.all([
		loadCompanyDefaultVacationPolicy(db, { organizationId, year: currentYear }),
		db
			.select({ id: employee.id, userId: employee.userId, name: user.name })
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(eq(employee.organizationId, organizationId)),
		db.query.user.findFirst({
			where: eq(user.id, performedBy),
			columns: { id: true },
		}),
		db.query.vacationCarryoverTransfer.findMany({
			where: and(
				eq(vacationCarryoverTransfer.organizationId, organizationId),
				eq(vacationCarryoverTransfer.outcome, "generated"),
				isNull(vacationCarryoverTransfer.expiredAt),
				lt(vacationCarryoverTransfer.expiryDate, currentDate),
			),
		}),
	]);
	const details: ExpiryResult["details"] = [];
	const targets = people.flatMap((person) =>
		[
			...new Set([
				currentYear,
				...dueTransfers
					.filter((row) => row.employeeId === person.id)
					.map((row) => row.sourceYear + 1),
			]),
		].map((year) => ({ person, year })),
	);
	for (const { person, year } of targets) {
		const expired = await db.transaction(async (tx) => {
			await tx
				.select({ id: employee.id })
				.from(employee)
				.where(
					and(
						eq(employee.organizationId, organizationId),
						eq(employee.id, person.id),
					),
				)
				.for("update");
			const allowance = await tx.query.employeeVacationAllowance.findFirst({
				where: and(
					eq(employeeVacationAllowance.employeeId, person.id),
					eq(employeeVacationAllowance.year, year),
				),
				orderBy: [
					desc(employeeVacationAllowance.updatedAt),
					desc(employeeVacationAllowance.id),
				],
			});
			if (!allowance || Number(allowance.customCarryoverDays ?? 0) <= 0) return;
			const transfer = await tx.query.vacationCarryoverTransfer.findFirst({
				where: and(
					eq(vacationCarryoverTransfer.organizationId, organizationId),
					eq(vacationCarryoverTransfer.employeeId, person.id),
					eq(vacationCarryoverTransfer.sourceYear, year - 1),
					eq(vacationCarryoverTransfer.outcome, "generated"),
				),
			});
			const frozen =
				transfer?.allowanceId === allowance.id ? transfer : undefined;
			const expiryDate = frozen
				? frozen.expiryDate
				: year === currentYear && policy?.allowCarryover
					? carryoverExpiryInstant(year, policy.carryoverExpiryMonths, timezone)
					: null;
			if (
				!expiryDate ||
				frozen?.expiredAt ||
				Temporal.Instant.compare(
					instant,
					Temporal.Instant.from(expiryDate.toISOString()),
				) <= 0
			)
				return;
			// A later manual amount has no proof that the job may erase it.
			if (
				frozen &&
				(Number(allowance.customCarryoverDays) !== Number(frozen.days) ||
					allowance.updatedAt.getTime() >
						(frozen.reviewedAt ?? frozen.createdAt).getTime())
			)
				return;
			const [updated] = await tx
				.update(employeeVacationAllowance)
				.set({ customCarryoverDays: "0", updatedAt: currentDate })
				.where(
					and(
						eq(employeeVacationAllowance.id, allowance.id),
						eq(employeeVacationAllowance.employeeId, person.id),
						eq(employeeVacationAllowance.year, year),
						eq(
							employeeVacationAllowance.customCarryoverDays,
							allowance.customCarryoverDays ?? "0",
						),
						eq(employeeVacationAllowance.updatedAt, allowance.updatedAt),
					),
				)
				.returning({ id: employeeVacationAllowance.id });
			if (!updated) return;
			if (frozen)
				await tx
					.update(vacationCarryoverTransfer)
					.set({ expiredAt: currentDate, expiredBy: performedBy })
					.where(
						and(
							eq(vacationCarryoverTransfer.id, frozen.id),
							eq(vacationCarryoverTransfer.organizationId, organizationId),
							eq(vacationCarryoverTransfer.employeeId, person.id),
						),
					);
			const daysExpired = Number(allowance.customCarryoverDays);
			if (actor)
				await tx.insert(auditLog).values({
					organizationId,
					entityId: person.id,
					entityType: "employee",
					employeeId: person.id,
					performedBy: actor.id,
					action: AuditAction.VACATION_CARRYOVER_EXPIRED,
					timestamp: currentDate,
					metadata: JSON.stringify({
						year,
						daysExpired,
						expiryDate: expiryDate.toISOString(),
						performedBy,
						source: frozen ? "frozen_transfer" : "legacy_policy",
					}),
				});
			return { employeeId: person.id, employeeName: person.name, daysExpired };
		});
		if (expired) {
			details.push(expired);
			logger.info(
				{
					organizationId,
					employeeId: person.id,
					performedBy,
					year,
					daysExpired: expired.daysExpired,
				},
				"Vacation carryover expired",
			);
		}
	}
	return {
		employeesAffected: details.length,
		daysExpired: details.reduce((sum, row) => sum + row.daysExpired, 0),
		details,
	};
}
