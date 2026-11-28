import "server-only";

import { sql } from "drizzle-orm";
import type { db as applicationDatabase } from "@/db";
import { type AuditTrail, withAuditTrail } from "@/lib/audit-trail";
import { type PersonalDetailsPart, PersonalDetailsRefusal } from "./types";

/**
 * A personal details write the database refused. It names at most the
 * PostgreSQL error code and carries no cause: the driver's error holds the
 * query's parameters and PostgreSQL's detail may echo the row, so either would
 * put IBANs, BICs or account holders into logs and trace spans.
 */
export class PersonalDetailsWriteFailure extends Error {
	constructor(readonly code: string | undefined) {
		super(
			code
				? `The personal details could not be saved (PostgreSQL ${code})`
				: "The personal details could not be saved",
		);
		this.name = "PersonalDetailsWriteFailure";
	}
}

type Database = typeof applicationDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** The PostgreSQL error code along `error`'s cause chain, and nothing else of it. */
function sqlStateOf(error: unknown): string | undefined {
	const seen = new Set<unknown>();
	let current = error;
	while (current !== null && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		const code = (current as { code?: unknown }).code;
		if (typeof code === "string" && SQLSTATE.test(code)) return code;
		current = (current as { cause?: unknown }).cause;
	}
	return undefined;
}

/** The one part of one employee's personal details a write changes. */
export type PersonalDetailsWriteScope = {
	organizationId: string;
	employeeId: string;
	part: PersonalDetailsPart;
};

/**
 * The one way the module writes personal details: `work` runs in a transaction
 * with an audit trail forwarded after commit. A refusal passes through; any
 * other failure becomes a value-free `PersonalDetailsWriteFailure`.
 *
 * Writes to the same part of the same employee run one after the other: the
 * transaction first takes a lock on `scope`, so `work` reads the part's history
 * as every earlier write left it (two overlapping ends never both survive).
 */
export async function inPersonalDetailsWriteTransaction<T>(
	database: Database,
	scope: PersonalDetailsWriteScope,
	work: (tx: Transaction, audit: AuditTrail) => Promise<T>,
): Promise<T> {
	const lockKey = `personal-details:${scope.organizationId}:${scope.employeeId}:${scope.part}`;
	try {
		return await withAuditTrail((audit) =>
			database.transaction(async (tx) => {
				await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
				return work(tx, audit);
			}),
		);
	} catch (error) {
		if (error instanceof PersonalDetailsRefusal) throw error;
		throw new PersonalDetailsWriteFailure(sqlStateOf(error));
	}
}
