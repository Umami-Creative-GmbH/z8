import type { db as appDb } from "@/db";
import {
	hasActiveExpenseOfficerGrant,
	listReimbursingOfficers,
} from "./expense-officer-grant-store";
import { listFinanceQueue } from "./settlement-store";

/**
 * The coverage gap (#756): approved reports and legacy claims awaiting
 * reimbursement that no active expense officer who can record reimbursements
 * covers. Owners and admins still can; the warning tells them where nobody
 * else will. An organization without any expense officer grant has no gap:
 * owners and admins handle everything there by design.
 */

type Database = typeof appDb;

export interface OfficerCoverageGap {
	/** Uncovered accounts awaiting reimbursement, at most the queue's result limit. */
	uncovered: number;
	/** More are uncovered than were counted. */
	truncated: boolean;
}

export async function loadOfficerCoverageGap(
	database: Database,
	input: { organizationId: string },
): Promise<OfficerCoverageGap | null> {
	const { organizationId } = input;
	if (!(await hasActiveExpenseOfficerGrant(database, { organizationId }))) return null;
	const officers = await listReimbursingOfficers(database, { organizationId });
	const page = await listFinanceQueue(database, {
		organizationId,
		filter: "open",
		uncoveredBy: officers,
	});
	return { uncovered: page.accounts.length, truncated: page.truncated };
}
