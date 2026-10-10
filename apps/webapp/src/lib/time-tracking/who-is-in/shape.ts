import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import type { Instant } from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import type { SettingsAccessTier } from "@/lib/settings-access";
import type { ActiveAssignedEmployee } from "../assigned-locations/queries";
import type { ClockPresence } from "../clock-presence";

/**
 * The who-is-in board (#863, spec #761): who of the employees assigned to a
 * location is clocked in or on a break in progress right now. Two views read
 * it, each shaped here so nothing more leaves the server than the view may show:
 *
 * - the kiosk board: first name and last initial with "in" or "on break", no
 *   times, no identities;
 * - the manager view: full names, the state and since when, limited to the
 *   employees the viewer may see.
 *
 * An employee without live work (clocked out) appears in neither.
 */
export type WhoIsInAssignedEmployee = ActiveAssignedEmployee;
export type WhoIsInPresence = ClockPresence;

export type KioskBoardState = "in" | "on_break";

/** One person on the kiosk board. Deliberately no id, no full last name and no time. */
export type KioskBoardEntry = { name: string; state: KioskBoardState };

/** Who a viewer of the manager view may see. */
export type WhoIsInScope =
	| { kind: "all" }
	| { kind: "managed"; employeeIds: ReadonlySet<string> }
	| { kind: "none" };

export type LocationPresenceEntry = {
	employeeId: string;
	name: string;
	state: ClockPresence["state"];
	/** Where the live work started, or the open break when on break. */
	since: Instant;
	/** The zone captured at that moment: the break's zone, or the clock-in's fixed offset. */
	sinceZone: string;
};

function trimmed(value: string | null | undefined): string | null {
	const result = value?.trim();
	return result ? result : null;
}

function initialOf(name: string): string {
	const [first = ""] = Array.from(name);
	return `${first.toLocaleUpperCase()}.`;
}

/**
 * First name and last initial ("Anna B."). Users without structured names fall
 * back to their display name, split into first and last word.
 */
export function kioskBoardName(person: WhoIsInAssignedEmployee): string {
	let firstName = trimmed(person.firstName);
	let lastName = trimmed(person.lastName);
	if (!firstName && !lastName) {
		const words = (trimmed(person.userName) ?? "").split(/\s+/).filter(Boolean);
		firstName = words[0] ?? null;
		lastName = words.length > 1 ? (words.at(-1) ?? null) : null;
	}
	return [firstName, lastName ? initialOf(lastName) : null].filter(Boolean).join(" ");
}

function presenceByEmployee(presence: readonly WhoIsInPresence[]) {
	return new Map(presence.map((row) => [row.employeeId, row]));
}

/** The kiosk board: assigned employees with live work, in the assigned order. */
export function toKioskBoard(
	assigned: readonly WhoIsInAssignedEmployee[],
	presence: readonly WhoIsInPresence[],
): KioskBoardEntry[] {
	const live = presenceByEmployee(presence);
	return assigned.flatMap((person) => {
		const row = live.get(person.employeeId);
		if (!row) return [];
		return [{ name: kioskBoardName(person), state: row.state === "on_break" ? "on_break" : "in" }];
	});
}

/** Owners and admins see every assigned employee, managers the ones they manage, others nobody. */
export function whoIsInScopeFor(input: {
	accessTier: SettingsAccessTier;
	managedEmployeeIds: readonly string[];
}): WhoIsInScope {
	if (input.accessTier === "orgAdmin") return { kind: "all" };
	if (input.accessTier === "manager") {
		return { kind: "managed", employeeIds: new Set(input.managedEmployeeIds) };
	}
	return { kind: "none" };
}

export function isInWhoIsInScope(scope: WhoIsInScope, employeeId: string): boolean {
	if (scope.kind === "all") return true;
	if (scope.kind === "managed") return scope.employeeIds.has(employeeId);
	return false;
}

function zoneOfOffset(offsetMinutes: number | undefined): string {
	if (offsetMinutes === undefined) return "UTC";
	try {
		return offsetMinutesToTimeZoneId(offsetMinutes);
	} catch {
		return "UTC";
	}
}

/** The manager view of one location: assigned employees in scope with live work. */
export function toLocationPresence(input: {
	assigned: readonly WhoIsInAssignedEmployee[];
	presence: readonly WhoIsInPresence[];
	/** The clock-in entry's captured UTC offset per live work period. */
	clockInOffsets: ReadonlyMap<string, number>;
	scope: WhoIsInScope;
}): LocationPresenceEntry[] {
	const live = presenceByEmployee(input.presence);
	return input.assigned.flatMap((person) => {
		const row = live.get(person.employeeId);
		if (!row || !isInWhoIsInScope(input.scope, person.employeeId)) return [];
		const onBreak = row.state === "on_break" && row.breakSince !== null;
		return [
			{
				employeeId: person.employeeId,
				name: buildAuthUserDisplayName({
					firstName: person.firstName,
					lastName: person.lastName,
					name: person.userName,
				}),
				state: row.state,
				since: onBreak && row.breakSince ? row.breakSince : row.workSince,
				sinceZone: onBreak
					? (row.breakZone ?? "UTC")
					: zoneOfOffset(input.clockInOffsets.get(row.workPeriodId)),
			},
		];
	});
}
