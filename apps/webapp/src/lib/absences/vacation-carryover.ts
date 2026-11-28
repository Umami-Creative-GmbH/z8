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
	vacationEarningYearLeave,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import type { VacationBalanceConfiguration } from "./types";
import type { CarryoverResult, CarryoverSummary, ExpiryResult } from "./vacation.service";
import { outsideVacationInYear } from "./prorated-allowance";
import { loadEmployeeEmployments } from "./prorated-allowance-store";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import {
	establishedExpiry,
	establishesExpiry,
	leaveProtection as leaveProtectionOf,
	planYearEndCarryover,
} from "./earning-year-leave";
import { loadLeaveExpiryClassifications } from "./earning-year-leave-store";
import { loadVacationBalances } from "./vacation-balance-store";
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
			.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true))),
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
					.where(and(eq(employee.organizationId, organizationId), eq(employee.id, person.id)))
					.for("update");
				if (!target) return;
				// No carry-over leaves or enters a year outside vacation, such as one spent entirely
				// as an External Contractor (#1996).
				const employments = (
					await loadEmployeeEmployments(tx, { organizationId, employeeIds: [person.id] })
				).get(person.id);
				if (
					!employments ||
					outsideVacationInYear(employments, fromYear) ||
					outsideVacationInYear(employments, toYear)
				)
					return;
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
					orderBy: [desc(employeeVacationAllowance.updatedAt), desc(employeeVacationAllowance.id)],
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
				// The balance store decides the source year the same way (#1996).
				if (source.externalContractors.has(person.id)) return;
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
					sourceResolution.status === "resolved" || sourceResolution.status === "legacy"
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
				const yearLeave = source.yearLeave.get(person.id);
				if (!yearLeave)
					throw new CarryoverConfigurationError(
						`Vacation policy missing for source year ${fromYear}; automatic carryover skipped`,
						{
							status: "missing",
							periods: [{ startDate: `${fromYear}-01-01`, endDate: `${fromYear}-12-31` }],
						},
					);
				const expiryDate = carryoverExpiryInstant(
					toYear,
					destinationPolicy.carryoverExpiryMonths,
					timezone,
				);
				// Each earning year carries under its own earning policy's designation (#2080).
				const plan = planYearEndCarryover({
					sourceYear: fromYear,
					leave: yearLeave.leave,
					used: yearLeave.settledUsed,
					yearEnd: instantFromDate(currentDate),
					allowCarryover: sourcePolicy.allowCarryover,
					maxCarryoverDays:
						sourcePolicy.maxCarryoverDays === null ? null : Number(sourcePolicy.maxCarryoverDays),
					receivingExpiry: expiryDate ? instantFromDate(expiryDate) : null,
				});
				const calculated = {
					remaining: plan.remaining,
					capped: plan.capped,
				};
				const applied = plan.applied;
				const protectionOf = new Map(yearLeave.leave.map((item) => [item.key, item]));
				const establishedDeadline = plan.carried
					.filter((row) => row.days > 0)
					.flatMap((row) => {
						const item = protectionOf.get(row.key);
						return item && establishesExpiry(item.protection) && row.configuredExpiry
							? [row.configuredExpiry]
							: [];
					})
					.toSorted((a, b) => a.epochMilliseconds - b.epochMilliseconds)[0];
				const resultExpiry = establishedDeadline ? dateFromInstant(establishedDeadline) : null;
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
				const [transfer] = await tx
					.insert(vacationCarryoverTransfer)
					.values({
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
					})
					.returning({ id: vacationCarryoverTransfer.id });
				const storedKeys = new Set(yearLeave.carried.map((item) => item.key));
				if (plan.carried.length)
					await tx.insert(vacationEarningYearLeave).values(
						plan.carried.map((row) => ({
							organizationId,
							employeeId: person.id,
							transferId: transfer.id,
							receivingYear: toYear,
							earningYear: row.earningYear,
							earningPolicyId: row.earningPolicyId,
							portion: row.portion,
							days: String(row.days),
							forfeitedDays: String(row.forfeitedDays),
							configuredExpiryDate: row.configuredExpiry
								? dateFromInstant(row.configuredExpiry)
								: null,
							timezone,
							carriedFromId: storedKeys.has(row.key) ? row.key : null,
							createdAt: committedAt,
						})),
					);
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
							carryoverCapped: calculated.capped,
							expiryDate: resultExpiry?.toISOString() ?? null,
							configuredExpiryDate: expiryDate?.toISOString() ?? null,
							earningYears: plan.carried.map((row) => ({
								earningYear: row.earningYear,
								earningPolicyId: row.earningPolicyId,
								portion: row.portion,
								days: row.days,
								forfeitedDays: row.forfeitedDays,
							})),
							timezone,
						}),
					});
				return {
					employeeId: person.id,
					employeeName: person.name,
					previousYearRemaining: calculated.remaining,
					carryoverApplied: applied,
					carryoverCapped: calculated.capped,
					expiryDate: resultExpiry,
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
			logger.error({ organizationId, employeeId: person.id, error }, "Vacation carryover skipped");
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
		totalDaysCarriedOver: results.reduce((sum, row) => sum + row.carryoverApplied, 0),
		results,
		errors,
	};
}

/**
 * Expires carried leave whose established deadline has passed (#2080). Committed transfers expire
 * per earning year: only leave whose earning policy establishes the deadline (policy terms, or
 * extra days under separately recorded terms) loses its unused days; unclassified and
 * German-protected leave stays outstanding. Each earning-year row expires once (`expired_at`) under
 * the employee row lock, whatever the retries or concurrent runs. Legacy carryover without a
 * transfer keeps its company-default treatment, but only once that policy is designated for its own
 * terms.
 */
export async function expireCommittedVacationCarryover(
	organizationId: string,
	performedBy: string,
	currentDate: Date,
	timezone: string,
): Promise<ExpiryResult> {
	const instant = Temporal.Instant.from(currentDate.toISOString());
	const currentYear = instant.toZonedDateTimeISO(timezone).year;
	const [policy, people, actor, dueLeave] = await Promise.all([
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
		db
			.select({
				employeeId: vacationEarningYearLeave.employeeId,
				receivingYear: vacationEarningYearLeave.receivingYear,
				earningPolicyId: vacationEarningYearLeave.earningPolicyId,
				portion: vacationEarningYearLeave.portion,
			})
			.from(vacationEarningYearLeave)
			.where(
				and(
					eq(vacationEarningYearLeave.organizationId, organizationId),
					isNull(vacationEarningYearLeave.expiredAt),
					lt(vacationEarningYearLeave.configuredExpiryDate, currentDate),
				),
			),
	]);
	const classifications = await loadLeaveExpiryClassifications(db, {
		organizationId,
		policyIds: [...dueLeave.map((row) => row.earningPolicyId), policy?.id],
	});
	const legacyExpiry =
		policy?.allowCarryover && classifications.get(policy.id)?.expiryRules === "policy_terms"
			? carryoverExpiryInstant(currentYear, policy.carryoverExpiryMonths, timezone)
			: null;
	const legacyDue =
		legacyExpiry !== null && Temporal.Instant.compare(instant, instantFromDate(legacyExpiry)) > 0;
	const establishedDue = dueLeave.filter((row) =>
		establishesExpiry(
			leaveProtectionOf(
				row.portion,
				row.earningPolicyId ? classifications.get(row.earningPolicyId) : undefined,
			),
		),
	);
	const details: ExpiryResult["details"] = [];
	const targets = people.flatMap((person) =>
		[
			...new Set([
				...(legacyDue ? [currentYear] : []),
				...establishedDue
					.filter((row) => row.employeeId === person.id)
					.map((row) => row.receivingYear),
			]),
		].map((year) => ({ person, year })),
	);
	for (const { person, year } of targets) {
		const expired = await db
			.transaction(async (tx) => {
				await tx
					.select({ id: employee.id })
					.from(employee)
					.where(and(eq(employee.organizationId, organizationId), eq(employee.id, person.id)))
					.for("update");
				const allowance = await tx.query.employeeVacationAllowance.findFirst({
					where: and(
						eq(employeeVacationAllowance.employeeId, person.id),
						eq(employeeVacationAllowance.year, year),
					),
					orderBy: [desc(employeeVacationAllowance.updatedAt), desc(employeeVacationAllowance.id)],
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
				const frozen = transfer?.allowanceId === allowance.id ? transfer : undefined;
				const debit = frozen
					? await expireEarningYearLeave(tx, {
							organizationId,
							employeeId: person.id,
							year,
							transferId: frozen.id,
							instant,
							currentDate,
							timezone,
							performedBy,
						})
					: year === currentYear && legacyDue && legacyExpiry
						? {
								days: Number(allowance.customCarryoverDays),
								expiryDate: legacyExpiry,
								earningYears: [],
							}
						: undefined;
				if (!debit || debit.days <= 0) return;
				const remainingCarryover =
					Math.round((Number(allowance.customCarryoverDays) - debit.days) * 100) / 100;
				const [updated] = await tx
					.update(employeeVacationAllowance)
					.set({ customCarryoverDays: String(remainingCarryover), updatedAt: currentDate })
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
				// A concurrent writer changed the amount: roll back the row debits and leave it for review.
				if (!updated) throw new ExpiryRaceLost();
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
							daysExpired: debit.days,
							expiryDate: debit.expiryDate.toISOString(),
							performedBy,
							source: frozen ? "earning_year_leave" : "legacy_policy",
							earningYears: debit.earningYears,
						}),
					});
				return { employeeId: person.id, employeeName: person.name, daysExpired: debit.days };
			})
			.catch((error: unknown) => {
				if (error instanceof ExpiryRaceLost) return undefined;
				throw error;
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

class ExpiryRaceLost extends Error {}

/**
 * Debits the unused days of each due earning-year row of one transfer, once. The receiving year's
 * balance decides what is unused: days charged on or before the deadline, approved or pending, in
 * the charge order. A manual amount on the receiving allowance is final and blocks the debit.
 */
async function expireEarningYearLeave(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	input: {
		organizationId: string;
		employeeId: string;
		year: number;
		transferId: string;
		instant: Temporal.Instant;
		currentDate: Date;
		timezone: string;
		performedBy: string;
	},
) {
	const balances = await loadVacationBalances(tx, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		year: input.year,
		timezone: input.timezone,
		currentDate: input.currentDate,
	});
	const yearLeave = balances.yearLeave.get(input.employeeId);
	if (!yearLeave) return;
	const due = yearLeave.carried.filter((item) => {
		const expiry = establishedExpiry(item);
		return (
			!item.key.startsWith("manual:") &&
			!item.debited &&
			!item.carriedForward &&
			expiry !== null &&
			Temporal.Instant.compare(input.instant, expiry) > 0
		);
	});
	let days = 0;
	let expiryDate: Date | undefined;
	const earningYears: { earningYear: number; portion: string; daysExpired: number }[] = [];
	for (const item of due) {
		const unused =
			Math.round(Math.max(0, item.capacity - (yearLeave.used.get(item.key) ?? 0)) * 100) / 100;
		const [marked] = await tx
			.update(vacationEarningYearLeave)
			.set({
				expiredDays: sql`${vacationEarningYearLeave.expiredDays} + ${String(unused)}::numeric`,
				expiredAt: input.currentDate,
				expiredBy: input.performedBy,
			})
			.where(
				and(
					eq(vacationEarningYearLeave.id, item.key),
					eq(vacationEarningYearLeave.organizationId, input.organizationId),
					eq(vacationEarningYearLeave.employeeId, input.employeeId),
					isNull(vacationEarningYearLeave.expiredAt),
				),
			)
			.returning({ id: vacationEarningYearLeave.id });
		if (!marked) continue;
		days += unused;
		const expiry = dateFromInstant(establishedExpiry(item) as Temporal.Instant);
		if (!expiryDate || expiry < expiryDate) expiryDate = expiry;
		earningYears.push({
			earningYear: item.earningYear,
			portion: item.portion,
			daysExpired: unused,
		});
	}
	if (!expiryDate) return;
	const open = await tx
		.select({ id: vacationEarningYearLeave.id })
		.from(vacationEarningYearLeave)
		.where(
			and(
				eq(vacationEarningYearLeave.transferId, input.transferId),
				isNull(vacationEarningYearLeave.expiredAt),
			),
		);
	if (!open.length)
		await tx
			.update(vacationCarryoverTransfer)
			.set({ expiredAt: input.currentDate, expiredBy: input.performedBy })
			.where(
				and(
					eq(vacationCarryoverTransfer.id, input.transferId),
					eq(vacationCarryoverTransfer.organizationId, input.organizationId),
					eq(vacationCarryoverTransfer.employeeId, input.employeeId),
					isNull(vacationCarryoverTransfer.expiredAt),
				),
			);
	return { days: Math.round(days * 100) / 100, expiryDate, earningYears };
}
