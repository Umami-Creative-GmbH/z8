import "server-only";

import { sql } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import { consumeInvitationDrafts, type JoiningDatabase } from "./invitation-draft";
import { joinMemberWithoutEmployee } from "./member-without-employee";

/**
 * The one-time backfill of #1671 (spec #1664 decision 9). Before every path
 * joined in the membership's transaction, the Better Auth paths could commit a
 * membership without an employee, and reads repaired them. The backfill joins
 * every approved member who still has no employee row, so the repairs on read
 * could go.
 *
 * Each member joins in their own transaction under the joining locks, and the
 * lookup is re-checked there: a member who has an employee row, current or not,
 * is never touched, so nobody deactivated is switched back on. No invitation
 * draft is applied (the membership is old), and no seat signal is sent (no seat
 * changed now); the hourly seat reconciliation counts them. Afterwards the
 * organization's consumed invitation drafts are cleared, as the repairs did.
 *
 * The dry run (default) lists the members it would join and writes nothing. A
 * second real run finds nobody left and joins nobody.
 */

const logger = createLogger("JoiningBackfill");

export type JoiningBackfillMember = {
	memberId: string;
	userId: string;
	name: string;
	role: string | null;
	/** The joined employee; null in a dry run. */
	employeeId: string | null;
};

export type JoiningBackfillReport = {
	organizationId: string;
	mode: "dry_run" | "apply";
	/** Members joined (or, in a dry run, who would be). */
	members: JoiningBackfillMember[];
	/** Members who could not be joined; nothing was changed for them. */
	failed: Array<{ memberId: string; userId: string; name: string; error: string }>;
};

export type JoiningBackfillOptions = {
	organizationIds?: readonly string[];
	/** Change data; without it the run is a dry run. */
	apply?: boolean;
};

type Candidate = { memberId: string; userId: string; name: string; role: string | null };

/** An approved member of the organization with no employee row there. */
const withoutEmployee = sql`
	m.status = 'approved'
	AND NOT EXISTS (
		SELECT 1 FROM employee e
		WHERE e.user_id = m.user_id AND e.organization_id = m.organization_id
	)
`;

async function findCandidates(
	database: JoiningDatabase,
	organizationId: string,
): Promise<Candidate[]> {
	const result = await database.execute<{
		member_id: string;
		user_id: string;
		name: string | null;
		role: string | null;
	}>(sql`
		SELECT m.id AS member_id, m.user_id, u.name, m.role
		FROM member m
		JOIN "user" u ON u.id = m.user_id
		WHERE m.organization_id = ${organizationId} AND ${withoutEmployee}
		ORDER BY m.created_at, m.id
	`);
	return result.rows.map((row) => ({
		memberId: row.member_id,
		userId: row.user_id,
		name: row.name ?? "",
		role: row.role,
	}));
}

async function organizationsWithCandidates(database: JoiningDatabase): Promise<string[]> {
	const result = await database.execute<{ organization_id: string }>(sql`
		SELECT DISTINCT m.organization_id FROM member m
		WHERE ${withoutEmployee}
		ORDER BY m.organization_id
	`);
	return result.rows.map((row) => row.organization_id);
}

async function backfillOrganization(
	database: JoiningDatabase,
	organizationId: string,
	apply: boolean,
): Promise<JoiningBackfillReport> {
	const report: JoiningBackfillReport = {
		organizationId,
		mode: apply ? "apply" : "dry_run",
		members: [],
		failed: [],
	};
	for (const candidate of await findCandidates(database, organizationId)) {
		if (!apply) {
			report.members.push({ ...candidate, employeeId: null });
			continue;
		}
		try {
			const { employee, joined } = await joinMemberWithoutEmployee(database, {
				organizationId,
				userId: candidate.userId,
				membership: { id: candidate.memberId, role: candidate.role },
			});
			// Someone else joined them since the lookup: nothing to report.
			if (joined) report.members.push({ ...candidate, employeeId: employee.id });
		} catch (error) {
			logger.error({ error, organizationId, userId: candidate.userId }, "Backfill failed");
			report.failed.push({
				memberId: candidate.memberId,
				userId: candidate.userId,
				name: candidate.name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	if (apply && report.members.length > 0) {
		await consumeInvitationDrafts(database, { organizationId });
	}
	return report;
}

/**
 * Runs the backfill for the named organizations, or for every organization
 * with an approved member who has no employee, one organization and one member
 * at a time. A dry run unless `apply` is set.
 */
export async function backfillMembersWithoutEmployee(
	database: JoiningDatabase,
	options: JoiningBackfillOptions = {},
): Promise<JoiningBackfillReport[]> {
	const organizationIds = options.organizationIds ?? (await organizationsWithCandidates(database));
	const reports: JoiningBackfillReport[] = [];
	for (const organizationId of organizationIds) {
		reports.push(await backfillOrganization(database, organizationId, options.apply === true));
	}
	return reports;
}
