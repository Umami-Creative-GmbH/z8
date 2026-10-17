import { enrollmentNotices } from "./notices";
import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { member, passkey, session, twoFactor } from "@/db/auth-schema";
import {
	auditLog,
	organizationMfaAccessOutcome,
	organizationMfaNotice,
	organizationMfaPolicy,
	organizationMfaWindow,
	sessionAuthentication,
	sessionMfaProof,
	userMfaRevision,
} from "@/db/schema";
import {
	type AuthTransaction,
	currentAuthTransaction,
} from "@/lib/auth/auth-transaction";
import {
	dateFromInstant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	evaluateOrganizationMfaAccess,
	type LocalMfaProof,
	type MfaSession,
} from "./access";
import { currentMfaDatabase } from "./database-context";
import { assignEnrollmentWindow } from "./policy";

export type MfaDatabase = typeof db | AuthTransaction;
type Client = MfaDatabase;
const client = () => currentMfaDatabase() ?? currentAuthTransaction() ?? db;
export const fingerprint = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const userScope = (userId: string) =>
	sql`SELECT id FROM "user" WHERE id=${userId} FOR UPDATE`;

export async function auditMfa(
	tx: Client,
	input: {
		organizationId: string;
		userId: string;
		action: string;
		entityId?: string;
		details?: Record<string, unknown>;
	},
) {
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		performedBy: input.userId,
		entityType: "organization_mfa",
		entityId: input.entityId ?? crypto.randomUUID(),
		action: input.action,
		metadata: JSON.stringify(input.details ?? {}),
	});
}

export async function getMfaRevision(userId: string): Promise<number> {
	const tx = client();
	await tx.insert(userMfaRevision).values({ userId }).onConflictDoNothing();
	const [row] = await tx
		.select()
		.from(userMfaRevision)
		.where(eq(userMfaRevision.userId, userId));
	return row.revision;
}

export async function factorFingerprint(
	userId: string,
	method: "totp" | "passkey",
	factorId: string,
	database: Client = client(),
): Promise<string | null> {
	const tx = database;
	if (method === "totp") {
		const [factor] = await tx
			.select({ secret: twoFactor.secret, verified: twoFactor.verified })
			.from(twoFactor)
			.where(and(eq(twoFactor.userId, userId), eq(twoFactor.id, factorId)));
		return factor ? fingerprint(factor.secret) : null;
	}
	const [factor] = await tx
		.select({ key: passkey.publicKey })
		.from(passkey)
		.where(and(eq(passkey.userId, userId), eq(passkey.id, factorId)));
	return factor ? fingerprint(factor.key) : null;
}

export async function readLocalMfaProof(
	subject: MfaSession,
	database: Client = client(),
): Promise<LocalMfaProof | null> {
	const tx = database;
	const [row] = await tx
		.select({ proof: sessionMfaProof })
		.from(sessionMfaProof)
		.innerJoin(
			session,
			and(
				eq(session.id, sessionMfaProof.sessionId),
				eq(session.userId, sessionMfaProof.userId),
				isNull(session.impersonatedBy),
				gt(session.expiresAt, dateFromInstant(systemClock.nowInstant())),
			),
		)
		.innerJoin(
			userMfaRevision,
			and(
				eq(userMfaRevision.userId, sessionMfaProof.userId),
				eq(userMfaRevision.revision, sessionMfaProof.revision),
			),
		)
		.where(
			and(
				eq(sessionMfaProof.sessionId, subject.id),
				eq(sessionMfaProof.userId, subject.userId),
			),
		);
	if (
		!row ||
		subject.impersonatedBy ||
		(await factorFingerprint(
			subject.userId,
			row.proof.method,
			row.proof.factorId,
			database,
		)) !== row.proof.factorFingerprint
	)
		return null;
	return {
		...row.proof,
		verifiedAt: instantFromDate(row.proof.verifiedAt).toString(),
	};
}

export async function saveLocalMfaProof(
	input: LocalMfaProof & { revision: number; factorFingerprint: string },
): Promise<void> {
	await client().transaction(async (tx) => {
		await tx.execute(userScope(input.userId));
		const [live] = await tx
			.select()
			.from(session)
			.where(
				and(
					eq(session.id, input.sessionId),
					eq(session.userId, input.userId),
					gt(session.expiresAt, dateFromInstant(systemClock.nowInstant())),
				),
			);
		const [revision] = await tx
			.select()
			.from(userMfaRevision)
			.where(eq(userMfaRevision.userId, input.userId));
		if (
			!live ||
			live.impersonatedBy ||
			revision?.revision !== input.revision ||
			(await factorFingerprint(input.userId, input.method, input.factorId)) !==
				input.factorFingerprint
		)
			return;
		await tx
			.insert(sessionMfaProof)
			.values({
				...input,
				verifiedAt: dateFromInstant(systemClock.nowInstant()),
			})
			.onConflictDoUpdate({
				target: sessionMfaProof.sessionId,
				set: {
					...input,
					verifiedAt: dateFromInstant(systemClock.nowInstant()),
				},
			});
	});
}

export async function recordPrimaryAuthentication(
	subject: MfaSession,
	method: "password" | "social" | "recovery",
	revision: number,
) {
	await client().transaction(async (tx) => {
		await tx.execute(userScope(subject.userId));
		const [current] = await tx
			.select()
			.from(userMfaRevision)
			.where(eq(userMfaRevision.userId, subject.userId));
		if (current?.revision !== revision) return;
		await tx
			.insert(sessionAuthentication)
			.values({
				sessionId: subject.id,
				userId: subject.userId,
				method,
				revision,
				verifiedAt: dateFromInstant(systemClock.nowInstant()),
			})
			.onConflictDoUpdate({
				target: sessionAuthentication.sessionId,
				set: {
					method,
					revision,
					verifiedAt: dateFromInstant(systemClock.nowInstant()),
				},
			});
	});
}

export async function readPrimaryAuthentication(subject: MfaSession) {
	const [row] = await client()
		.select({ proof: sessionAuthentication })
		.from(sessionAuthentication)
		.innerJoin(
			userMfaRevision,
			and(
				eq(userMfaRevision.userId, sessionAuthentication.userId),
				eq(userMfaRevision.revision, sessionAuthentication.revision),
			),
		)
		.where(
			and(
				eq(sessionAuthentication.sessionId, subject.id),
				eq(sessionAuthentication.userId, subject.userId),
			),
		);
	return row
		? {
				...row.proof,
				verifiedAt: instantFromDate(row.proof.verifiedAt).toString(),
			}
		: null;
}

/** The factor write has already atomically invalidated proof and staged its notice. */
export async function recordMfaRecovery(userId: string) {
	await client().transaction(async (tx) => {
		const affected = await tx
			.select({ organizationId: organizationMfaPolicy.organizationId })
			.from(organizationMfaPolicy)
			.innerJoin(
				member,
				and(
					eq(member.organizationId, organizationMfaPolicy.organizationId),
					eq(member.userId, userId),
				),
			)
			.where(eq(organizationMfaPolicy.enabled, true));
		for (const { organizationId } of affected)
			await auditMfa(tx, {
				organizationId,
				userId,
				action: "mfa.backup_code_recovery",
				details: { outcome: "replacement_enrollment_only" },
			});
	});
}
export async function materializeMfaWindow(
	organizationId: string,
	userId: string,
	database: Client = client(),
) {
	return database.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(organizationMfaWindow)
			.where(
				and(
					eq(organizationMfaWindow.organizationId, organizationId),
					eq(organizationMfaWindow.userId, userId),
				),
			)
			.for("update");
		if (!row) return null;
		const window = assignEnrollmentWindow({
			startsAt: instantFromDate(row.startsAt).toString(),
			gracePeriodDays: row.gracePeriodDays,
		});
		if (!row.deadline) {
			const deadline = dateFromInstant(Temporal.Instant.from(window.deadline));
			await tx
				.update(organizationMfaWindow)
				.set({ deadline })
				.where(eq(organizationMfaWindow.id, row.id));
			await auditMfa(tx, {
				organizationId,
				userId,
				entityId: row.id,
				action: "mfa.deadline_assigned",
				details: { ...window },
			});
			for (const { kind, dueAt } of enrollmentNotices(
				window.deadline,
				systemClock.nowInstant(),
			)) {
				await tx
					.insert(organizationMfaNotice)
					.values({
						organizationId,
						userId,
						kind,
						dueAt: dateFromInstant(Temporal.Instant.from(dueAt)),
						deduplicationKey: `${row.id}:${kind}`,
						payload: { deadline: window.deadline },
					})
					.onConflictDoNothing();
			}
		}
		return {
			...row,
			deadline: row.deadline
				? instantFromDate(row.deadline).toString()
				: window.deadline,
		};
	});
}

export async function getOrganizationMfaRequirement(
	subject: MfaSession,
	organizationId: string,
	ssoExempt: boolean,
	database: Client = client(),
) {
	const [policy] = await database
		.select()
		.from(organizationMfaPolicy)
		.where(eq(organizationMfaPolicy.organizationId, organizationId));
	if (!policy?.enabled) return { allowed: true, reason: "disabled" } as const;
	const [window, proof] = await Promise.all([
		materializeMfaWindow(organizationId, subject.userId, database),
		readLocalMfaProof(subject, database),
	]);
	const decision = evaluateOrganizationMfaAccess({
		enabled: true,
		deadline: window?.deadline ?? null,
		now: systemClock.nowInstant(),
		session: subject,
		localProof: proof,
		ssoExempt,
	});
	// Membership still belongs to the caller. Avoid recording information about a stranger's organization.
	if (window)
		await recordAccessOutcome(
			subject,
			organizationId,
			decision.reason,
			window.id,
			`${decision.reason}:${policy.updatedAt.toISOString()}:${decision.allowed && decision.reason === "local" ? (proof?.verifiedAt ?? "") : ""}`,
			database,
		);
	return decision;
}

async function recordAccessOutcome(
	subject: MfaSession,
	organizationId: string,
	outcome: string,
	windowId: string,
	outcomeKey: string,
	database: Client = client(),
) {
	await database.transaction(async (tx) => {
		await tx
			.insert(organizationMfaAccessOutcome)
			.values({ organizationId, sessionId: subject.id, outcome: "unknown" })
			.onConflictDoNothing();
		const [previous] = await tx
			.select()
			.from(organizationMfaAccessOutcome)
			.where(
				and(
					eq(organizationMfaAccessOutcome.organizationId, organizationId),
					eq(organizationMfaAccessOutcome.sessionId, subject.id),
				),
			)
			.for("update");
		if (previous.outcome !== outcomeKey) {
			await auditMfa(tx, {
				organizationId,
				userId: subject.userId,
				entityId: windowId,
				action:
					outcome === "MFA_REQUIRED"
						? "mfa.access_denied"
						: outcome === "local" || outcome === "sso"
							? "mfa.qualifying_authentication"
							: "mfa.access_allowed",
				details: { outcome },
			});
			await tx
				.update(organizationMfaAccessOutcome)
				.set({ outcome: outcomeKey })
				.where(
					and(
						eq(organizationMfaAccessOutcome.organizationId, organizationId),
						eq(organizationMfaAccessOutcome.sessionId, subject.id),
					),
				);
		}
		if (outcome === "local" || outcome === "sso")
			await tx
				.update(organizationMfaWindow)
				.set({
					lastQualifyingAccessAt: dateFromInstant(systemClock.nowInstant()),
				})
				.where(eq(organizationMfaWindow.id, windowId));
	});
}

import { Temporal } from "temporal-polyfill";
