import "server-only";

import type { db as applicationDatabase } from "@/db";
import { type AuditTrail, withAuditTrail } from "@/lib/audit-trail";
import { PersonalDetailsRefusal } from "./types";

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

/**
 * The one way the module writes personal details: `work` runs in a transaction
 * with an audit trail forwarded after commit. A refusal passes through; any
 * other failure becomes a value-free `PersonalDetailsWriteFailure`.
 */
export async function inPersonalDetailsWriteTransaction<T>(
	database: Database,
	work: (tx: Transaction, audit: AuditTrail) => Promise<T>,
): Promise<T> {
	try {
		return await withAuditTrail((audit) => database.transaction((tx) => work(tx, audit)));
	} catch (error) {
		if (error instanceof PersonalDetailsRefusal) throw error;
		throw new PersonalDetailsWriteFailure(sqlStateOf(error));
	}
}
