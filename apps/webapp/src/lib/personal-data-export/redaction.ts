/**
 * Other people in a personal data export (#811, #1168): the redaction rule for
 * **actions the employee took on others**.
 *
 * A personal data export names the people who acted on the employee's own
 * records (an approver, a manager who edited an entry). A record of something
 * the employee did to another person (a decision on a colleague's request, an
 * audit entry about a colleague) keeps the action, its time and the kind of
 * record, but identifies the other person only by an opaque id: no name, no
 * dates, no reason, none of their data, and not their database id, which a
 * reader with access to the app could look up.
 *
 * ```ts
 * const people = otherPeopleOf(scope);
 * actionOnOtherRow(people, {
 *   recordKind: "absence", authority: "canonical", action: "approved",
 *   actedAt: decidedAt, asDeputy: false, otherEmployeeId: requesterId,
 * });
 * // { record_kind: "absence", ..., other_person: "person-3f9a2c1b4d5e6f70" }
 * ```
 *
 * Opaque ids are an HMAC of the person's id under a random key per export
 * (per `PersonalDataExportScope` object, which the pipeline shares across all
 * categories of one export). So one colleague keeps one id across every
 * category of an export, the reader can tell decisions on the same person
 * apart from decisions on different people, and nobody can recompute the id
 * from a list of employee ids, nor link ids across two exports.
 */

import { createHmac, randomBytes } from "node:crypto";
import type { PersonalDataExportScope, PersonalDataRow } from "./collector";
import { instantText } from "./values";

/** Opaque ids for the other people of one export. */
export interface OtherPeople {
	/** The opaque id of an employee of the organization, or null for no id. */
	employee(employeeId: string | null | undefined): string | null;
	/**
	 * The opaque id of a user. A user linked to their employee id
	 * (`linkUser`) gets that employee's id, so a person referenced by user id
	 * in one table and by employee id in another keeps one opaque id.
	 */
	user(userId: string | null | undefined): string | null;
	/** Tells the export that `userId` is the user of `employeeId` in this organization. */
	linkUser(userId: string, employeeId: string): void;
}

const exportKeys = new WeakMap<PersonalDataExportScope, OtherPeople>();

/** The other people of the export `scope` belongs to (one key per scope object). */
export function otherPeopleOf(scope: PersonalDataExportScope): OtherPeople {
	const known = exportKeys.get(scope);
	if (known) return known;
	const people = createOtherPeople(randomBytes(32));
	exportKeys.set(scope, people);
	return people;
}

function createOtherPeople(key: Uint8Array): OtherPeople {
	const employeeOfUser = new Map<string, string>();
	const opaque = (namespace: "employee" | "user", id: string) =>
		`person-${createHmac("sha256", key).update(`${namespace}:${id}`).digest("hex").slice(0, 16)}`;
	return {
		employee: (employeeId) => (employeeId ? opaque("employee", employeeId) : null),
		user(userId) {
			if (!userId) return null;
			const employeeId = employeeOfUser.get(userId);
			return employeeId ? opaque("employee", employeeId) : opaque("user", userId);
		},
		linkUser(userId, employeeId) {
			employeeOfUser.set(userId, employeeId);
		},
	};
}

/** The columns of a record of an action the employee took on another person. */
export const ACTION_ON_OTHERS_COLUMNS = [
	"record_kind",
	"authority",
	"action",
	"acted_at",
	"as_deputy",
	"other_person",
] as const;

export interface ActionOnOther {
	/** What kind of record the action was on, e.g. `absence`, `time_correction`. */
	recordKind: string;
	/** Which store holds the action: `legacy`, `canonical` approvals, or the `record` itself. */
	authority: string;
	/** What the employee did, e.g. `approved`, `rejected`. */
	action: string;
	actedAt: Date | null;
	/** The employee acted as the covering deputy of the assigned approver. */
	asDeputy: boolean;
	/** The other person, by employee id (preferred) or user id. */
	otherEmployeeId?: string | null;
	otherUserId?: string | null;
}

/**
 * Actions on other people as export rows, oldest first (undated ones first);
 * actions at the same time by record kind, then in the given order.
 */
export function actionOnOtherRows(
	people: OtherPeople,
	actions: readonly ActionOnOther[],
): PersonalDataRow[] {
	return actions
		.toSorted(
			(left, right) =>
				(left.actedAt?.getTime() ?? 0) - (right.actedAt?.getTime() ?? 0) ||
				left.recordKind.localeCompare(right.recordKind),
		)
		.map((action) => actionOnOtherRow(people, action));
}

/** One action on another person as an export row: nothing about them but an opaque id. */
export function actionOnOtherRow(people: OtherPeople, action: ActionOnOther): PersonalDataRow {
	return {
		record_kind: action.recordKind,
		authority: action.authority,
		action: action.action,
		acted_at: instantText(action.actedAt),
		as_deputy: action.asDeputy,
		other_person: action.otherEmployeeId
			? people.employee(action.otherEmployeeId)
			: people.user(action.otherUserId),
	};
}
