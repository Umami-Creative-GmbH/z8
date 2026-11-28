import { and, desc, eq, sql } from "drizzle-orm";
import { employeeBankAccount } from "@/db/schema/personal-details";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { BankAccountValue } from "./validation";

/**
 * The bank account history table, reached only through the personal details
 * module. Every query is scoped by organization and employee.
 */

type Reader = Pick<DatabaseClient, "select">;
type Writer = Pick<DatabaseClient, "insert">;

export type StoredBankAccountEntry = {
	validFrom: string;
	value: BankAccountValue | null;
};

/** The employee's bank account history in the organization, latest valid-from first. */
export async function loadBankAccountHistory(
	db: Reader,
	scope: { organizationId: string; employeeId: string },
): Promise<StoredBankAccountEntry[]> {
	const rows = await db
		.select({
			validFrom: employeeBankAccount.validFrom,
			accountHolder: employeeBankAccount.accountHolder,
			iban: employeeBankAccount.iban,
			bic: employeeBankAccount.bic,
		})
		.from(employeeBankAccount)
		.where(
			and(
				eq(employeeBankAccount.organizationId, scope.organizationId),
				eq(employeeBankAccount.employeeId, scope.employeeId),
			),
		)
		.orderBy(desc(employeeBankAccount.validFrom));
	return rows.map((row) => ({
		validFrom: row.validFrom,
		value:
			row.accountHolder !== null && row.iban !== null
				? { accountHolder: row.accountHolder, iban: row.iban, bic: row.bic }
				: null,
	}));
}

/**
 * Records `value` (null ends the bank account) from `validFrom`. A row with the
 * same valid-from is replaced: `replaced` tells the caller it was a correction.
 */
export async function writeBankAccountEntry(
	db: Writer,
	entry: {
		organizationId: string;
		employeeId: string;
		validFrom: string;
		value: BankAccountValue | null;
		actorUserId: string;
	},
): Promise<{ replaced: boolean }> {
	const value = {
		accountHolder: entry.value?.accountHolder ?? null,
		iban: entry.value?.iban ?? null,
		bic: entry.value?.bic ?? null,
	};
	const [row] = await db
		.insert(employeeBankAccount)
		.values({
			organizationId: entry.organizationId,
			employeeId: entry.employeeId,
			validFrom: entry.validFrom,
			...value,
			createdBy: entry.actorUserId,
			updatedBy: entry.actorUserId,
		})
		.onConflictDoUpdate({
			target: [
				employeeBankAccount.organizationId,
				employeeBankAccount.employeeId,
				employeeBankAccount.validFrom,
			],
			set: { ...value, updatedBy: entry.actorUserId, updatedAt: sql`now()` },
		})
		// PostgreSQL sets xmax on the row an upsert updated, not on one it inserted.
		.returning({ inserted: sql<boolean>`(xmax = 0)` });
	return { replaced: row?.inserted === false };
}
