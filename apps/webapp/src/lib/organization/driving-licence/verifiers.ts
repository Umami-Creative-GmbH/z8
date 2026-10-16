import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { db as appDb } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, employeeEmploymentPeriod, team } from "@/db/schema";
import { drivingLicenceVerifierGrant } from "@/db/schema/driving-licence-verifiers";
import {
	dateFromInstant,
	type Instant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";

export type DrivingLicenceDatabase = Pick<typeof appDb, "select">;
export type DrivingLicenceTransaction = Parameters<
	Parameters<typeof appDb.transaction>[0]
>[0];
export const verifierGrantInput = z
	.object({
		verifierEmployeeId: z.uuid(),
		scope: z.enum(["all", "specific"]),
		teamIds: z.array(z.uuid()).max(1000),
		employeeIds: z.array(z.uuid()).max(1000),
		expiresAt: z.string().nullable().optional(),
	})
	.superRefine((value, context) => {
		if (
			value.scope === "specific" &&
			value.teamIds.length + value.employeeIds.length === 0
		)
			context.addIssue({
				code: "custom",
				message: "Choose employees or teams",
				path: ["scope"],
			});
		if (
			value.scope === "all" &&
			value.teamIds.length + value.employeeIds.length > 0
		)
			context.addIssue({
				code: "custom",
				message:
					"Organization scope cannot contain selected employees or teams",
				path: ["scope"],
			});
	});
export type SaveDrivingLicenceVerifierGrantInput = z.input<
	typeof verifierGrantInput
>;
export interface DrivingLicenceVerifierGrantRecord {
	id: string;
	verifierEmployeeId: string;
	employmentPeriodId: string | null;
	scope: "all" | "specific";
	teamIds: string[];
	employeeIds: string[];
	grantedAt: string;
	grantedBy: string;
	expiresAt: string | null;
	revokedAt: string | null;
	revokedBy: string | null;
}
function present(
	row: typeof drivingLicenceVerifierGrant.$inferSelect,
): DrivingLicenceVerifierGrantRecord {
	return {
		...row,
		grantedAt: row.grantedAt.toISOString(),
		expiresAt: row.expiresAt?.toISOString() ?? null,
		revokedAt: row.revokedAt?.toISOString() ?? null,
	};
}
export async function listDrivingLicenceVerifierGrants(
	database: DrivingLicenceDatabase,
	organizationId: string,
) {
	return (
		await database
			.select()
			.from(drivingLicenceVerifierGrant)
			.where(eq(drivingLicenceVerifierGrant.organizationId, organizationId))
			.orderBy(
				drivingLicenceVerifierGrant.grantedAt,
				drivingLicenceVerifierGrant.id,
			)
	).map(present);
}
/** Fresh membership and departure checks are mandatory even for notification/worklist callers. */
export async function loadDrivingLicenceVerifierGrant(
	database: DrivingLicenceDatabase,
	input: { organizationId: string; verifierEmployeeId: string; now?: Instant },
): Promise<DrivingLicenceVerifierGrantRecord | null> {
	const at = dateFromInstant(input.now ?? systemClock.nowInstant());
	const [row] = await database
		.select({ grant: drivingLicenceVerifierGrant })
		.from(drivingLicenceVerifierGrant)
		.innerJoin(
			employee,
			and(
				eq(employee.id, drivingLicenceVerifierGrant.verifierEmployeeId),
				eq(employee.organizationId, drivingLicenceVerifierGrant.organizationId),
			),
		)
		.innerJoin(
			member,
			and(
				eq(member.userId, employee.userId),
				eq(member.organizationId, employee.organizationId),
				eq(member.status, "approved"),
			),
		)
		.where(
			and(
				eq(drivingLicenceVerifierGrant.organizationId, input.organizationId),
				eq(
					drivingLicenceVerifierGrant.verifierEmployeeId,
					input.verifierEmployeeId,
				),
				isNull(drivingLicenceVerifierGrant.revokedAt),
				employeeHasOrganizationAccess(input.now),
				sql`(${drivingLicenceVerifierGrant.expiresAt} IS NULL OR ${drivingLicenceVerifierGrant.expiresAt} > ${at})`,
				sql`(${drivingLicenceVerifierGrant.employmentPeriodId} IS NULL OR EXISTS (SELECT 1 FROM employee_employment_period p WHERE p.id = ${drivingLicenceVerifierGrant.employmentPeriodId} AND p.organization_id = ${input.organizationId} AND p.employee_id = ${input.verifierEmployeeId} AND p.status = 'open'))`,
				sql`NOT EXISTS (SELECT 1 FROM employee_departure d WHERE d.organization_id = ${input.organizationId} AND d.employee_id = ${input.verifierEmployeeId} AND d.status = 'effective' AND d.cutoff_at >= ${drivingLicenceVerifierGrant.grantedAt})`,
			),
		)
		.limit(1);
	return row ? present(row.grant) : null;
}
export async function saveDrivingLicenceVerifierGrant(
	tx: DrivingLicenceTransaction,
	input: {
		organizationId: string;
		actorUserId: string;
		grant: SaveDrivingLicenceVerifierGrantInput;
	},
) {
	const value = verifierGrantInput.parse(input.grant);
	const now = systemClock.nowInstant();
	const expiresAt = value.expiresAt ? parseInstant(value.expiresAt) : null;
	if (expiresAt && expiresAt.epochNanoseconds <= now.epochNanoseconds)
		throw new Error("Expiry must be in the future");
	// Serialize replacements and grants for the same recipient, including when no grant exists yet.
	await tx.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${value.verifierEmployeeId}:driving-verifier`}, 0))`,
	);
	const [recipient] = await tx
		.select({ id: employee.id })
		.from(employee)
		.innerJoin(
			member,
			and(
				eq(member.userId, employee.userId),
				eq(member.organizationId, employee.organizationId),
				eq(member.status, "approved"),
			),
		)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.id, value.verifierEmployeeId),
				employeeHasOrganizationAccess(now),
			),
		)
		.limit(1);
	if (!recipient)
		throw new Error("Choose a current employee of this organization");
	const [people, teams] = await Promise.all([
		value.employeeIds.length
			? tx
					.select({ id: employee.id })
					.from(employee)
					.where(
						and(
							eq(employee.organizationId, input.organizationId),
							inArray(employee.id, [...new Set(value.employeeIds)]),
						),
					)
			: [],
		value.teamIds.length
			? tx
					.select({ id: team.id })
					.from(team)
					.where(
						and(
							eq(team.organizationId, input.organizationId),
							inArray(team.id, [...new Set(value.teamIds)]),
						),
					)
			: [],
	]);
	if (
		people.length !== new Set(value.employeeIds).size ||
		teams.length !== new Set(value.teamIds).size
	)
		throw new Error("All scope selections must belong to this organization");
	await tx
		.update(drivingLicenceVerifierGrant)
		.set({ revokedAt: dateFromInstant(now), revokedBy: input.actorUserId })
		.where(
			and(
				eq(drivingLicenceVerifierGrant.organizationId, input.organizationId),
				eq(
					drivingLicenceVerifierGrant.verifierEmployeeId,
					value.verifierEmployeeId,
				),
				isNull(drivingLicenceVerifierGrant.revokedAt),
			),
		);
	const [period] = await tx
		.select({ id: employeeEmploymentPeriod.id })
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				eq(employeeEmploymentPeriod.employeeId, value.verifierEmployeeId),
				eq(employeeEmploymentPeriod.status, "open"),
			),
		)
		.limit(1);
	const [created] = await tx
		.insert(drivingLicenceVerifierGrant)
		.values({
			organizationId: input.organizationId,
			verifierEmployeeId: value.verifierEmployeeId,
			employmentPeriodId: period?.id ?? null,
			scope: value.scope,
			teamIds: [...new Set(value.teamIds)].sort(),
			employeeIds: [...new Set(value.employeeIds)].sort(),
			grantedBy: input.actorUserId,
			grantedAt: dateFromInstant(now),
			expiresAt: expiresAt ? dateFromInstant(expiresAt) : null,
		})
		.returning({ id: drivingLicenceVerifierGrant.id });
	if (!created) throw new Error("Could not create verifier grant");
	return created.id;
}
export async function revokeDrivingLicenceVerifierGrant(
	tx: DrivingLicenceTransaction,
	input: { organizationId: string; actorUserId: string; grantId: string },
) {
	const grantId = z.uuid().parse(input.grantId);
	const [row] = await tx
		.update(drivingLicenceVerifierGrant)
		.set({
			revokedAt: dateFromInstant(systemClock.nowInstant()),
			revokedBy: input.actorUserId,
		})
		.where(
			and(
				eq(drivingLicenceVerifierGrant.organizationId, input.organizationId),
				eq(drivingLicenceVerifierGrant.id, grantId),
				isNull(drivingLicenceVerifierGrant.revokedAt),
			),
		)
		.returning({ id: drivingLicenceVerifierGrant.id });
	if (!row) throw new Error("Verifier grant is unavailable");
	return row.id;
}

/** Lifecycle callers must name the employment period being ended; delayed work cannot revoke a fresh grant. */
export async function revokeDrivingLicenceVerifierGrantsHeldBy(
	tx: DrivingLicenceTransaction,
	input: {
		organizationId: string;
		verifierEmployeeId: string;
		employmentPeriodId: string | null;
		actorUserId: string;
		now?: Instant;
	},
) {
	await tx
		.update(drivingLicenceVerifierGrant)
		.set({
			revokedAt: dateFromInstant(input.now ?? systemClock.nowInstant()),
			revokedBy: input.actorUserId,
		})
		.where(
			and(
				eq(drivingLicenceVerifierGrant.organizationId, input.organizationId),
				eq(
					drivingLicenceVerifierGrant.verifierEmployeeId,
					input.verifierEmployeeId,
				),
				input.employmentPeriodId
					? eq(
							drivingLicenceVerifierGrant.employmentPeriodId,
							input.employmentPeriodId,
						)
					: isNull(drivingLicenceVerifierGrant.employmentPeriodId),
				isNull(drivingLicenceVerifierGrant.revokedAt),
			),
		);
}
