import "server-only";

import { randomUUID } from "node:crypto";
import { db as applicationDatabase } from "@/db";
import { AuditAction } from "@/lib/audit-logger";
import { withAuditTrail } from "@/lib/audit-trail";
import { type Clock, plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { type PersonalDetailsRight, resolvePersonalDetailsRight } from "./access";
import {
	loadBankAccountHistory,
	type StoredBankAccountEntry,
	writeBankAccountEntry,
} from "./bank-account-store";
import {
	buildPersonalDetailsChangedNotice,
	emailPersonalDetailsChangedNotice,
	recordPersonalDetailsChangedNotice,
} from "./changed-notice";
import {
	type BankAccountView,
	type PersonalDetailsChangeInput,
	type PersonalDetailsEntry,
	type PersonalDetailsHistory,
	PersonalDetailsRefusal,
	type PersonalDetailsView,
} from "./types";
import { ibanLastFour, parseBankAccount, parseValidFrom } from "./validation";

/**
 * The personal details module (spec #2068): an employee's bank account (and,
 * from #2070, health insurance) in one organization, each a date-effective
 * history. Its operations are the only way to read or change them; who may see
 * and change is resolved by `resolvePersonalDetailsRight` alone.
 *
 * Every applied change records a value-free audit entry and an in-app notice in
 * its own transaction, then emails the employee: the mandatory "personal details
 * changed" notice, which notification preferences cannot switch off.
 */

export type PersonalDetailsDatabase = typeof applicationDatabase;

export type PersonalDetailsDependencies = {
	database?: PersonalDetailsDatabase;
	clock?: Clock;
};

type Scope = {
	organizationId: string;
	/** The acting user; the module resolves their right itself. */
	actorUserId: string;
	employeeId: string;
};

function bankAccountView(
	entry: StoredBankAccountEntry,
	revealed: boolean,
): PersonalDetailsEntry<BankAccountView> {
	if (!entry.value) return { validFrom: entry.validFrom, value: null };
	return {
		validFrom: entry.validFrom,
		value: {
			accountHolder: entry.value.accountHolder,
			iban: revealed ? entry.value.iban : null,
			ibanLastFour: ibanLastFour(entry.value.iban),
			bic: entry.value.bic,
		},
	};
}

/** The entry in force on `on` of a history ordered latest valid-from first; none once ended. */
function inForce<Value>(
	history: PersonalDetailsEntry<Value>[],
	on: string,
): PersonalDetailsEntry<Value> | null {
	// ISO calendar days compare as strings.
	const entry = history.find((candidate) => candidate.validFrom <= on);
	return entry?.value ? entry : null;
}

function historyOf<Value>(
	history: PersonalDetailsEntry<Value>[],
	on: string,
): PersonalDetailsHistory<Value> {
	return { current: inForce(history, on), history };
}

/**
 * The employee's personal details for the acting user: in force on `on` (by
 * default today in the organization's timezone) with their history. Null when the
 * actor has no right to see them, the employee is unknown or another
 * organization's. The employee sees their own IBANs in full; a decider sees only
 * their last four characters unless `reveal` is set.
 */
export async function readPersonalDetails(
	input: Scope & { on?: string; reveal?: boolean },
	dependencies: PersonalDetailsDependencies = {},
): Promise<PersonalDetailsView | null> {
	const database = dependencies.database ?? applicationDatabase;
	const clock = dependencies.clock ?? systemClock;
	const right = await resolvePersonalDetailsRight(database, input);
	if (right.kind === "none") return null;
	let on = input.on;
	if (on === undefined) {
		const timezone = await loadOrganizationTimezone(database, input.organizationId);
		on = plainDateAt(clock.nowInstant(), timezone).toString();
	} else if (!parseValidFrom(on).ok) {
		throw new PersonalDetailsRefusal("invalid_input", "Invalid day");
	}
	const revealed = right.kind === "own" || input.reveal === true;
	const bankAccounts = await loadBankAccountHistory(database, input);
	return {
		employeeId: input.employeeId,
		on,
		viewer: { own: right.kind === "own", mayChange: right.kind === "decider", revealed },
		bankAccount: historyOf(
			bankAccounts.map((entry) => bankAccountView(entry, revealed)),
			on,
		),
	};
}

function refuseUnlessDecider(right: PersonalDetailsRight) {
	if (right.kind === "none") {
		throw new PersonalDetailsRefusal("not_found", "Employee not found");
	}
	if (right.kind === "own") {
		throw new PersonalDetailsRefusal(
			"own_details",
			"Your own personal details are changed by a personal details change request",
		);
	}
	return right;
}

/**
 * A decider changes a part of the employee's personal details from a valid-from
 * day, past days included. The same valid-from as an existing entry replaces it;
 * a later one adds to the history. The employee is always told.
 */
export async function changePersonalDetails(
	input: Scope & PersonalDetailsChangeInput,
	dependencies: PersonalDetailsDependencies = {},
): Promise<{ replaced: boolean }> {
	const database = dependencies.database ?? applicationDatabase;
	const validFrom = parseValidFrom(input.validFrom);
	const value = parseBankAccount(input.value);
	if (!validFrom.ok || !value.ok) {
		throw new PersonalDetailsRefusal("invalid_input", "The personal details are not valid", {
			fields: {
				...(value.ok ? {} : value.errors),
				...(validFrom.ok ? {} : { validFrom: validFrom.code }),
			},
		});
	}
	const day = validFrom.value.toString();
	const { notice, replaced } = await withAuditTrail((audit) =>
		database.transaction(async (tx) => {
			const right = refuseUnlessDecider(await resolvePersonalDetailsRight(tx, input));
			const { replaced } = await writeBankAccountEntry(tx, {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				validFrom: day,
				value: value.value,
				actorUserId: input.actorUserId,
			});
			await audit.record(tx, {
				organizationId: input.organizationId,
				action: AuditAction.PERSONAL_DETAILS_CHANGED,
				actorUserId: input.actorUserId,
				targetType: "employee",
				targetId: input.employeeId,
				employeeId: input.employeeId,
				// Never the values: the audit log must not hold another copy of them.
				metadata: { part: input.part, validFrom: day, correction: replaced },
			});
			const notice = buildPersonalDetailsChangedNotice({
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				employeeUserId: right.employeeUserId,
				part: input.part,
				validFrom: day,
				ibanLastFour: ibanLastFour(value.value.iban),
				changeId: randomUUID(),
			});
			await recordPersonalDetailsChangedNotice(tx, notice);
			return { notice, replaced };
		}),
	);
	await emailPersonalDetailsChangedNotice(notice);
	return { replaced };
}
