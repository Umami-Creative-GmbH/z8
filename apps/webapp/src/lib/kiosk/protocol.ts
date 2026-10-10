/**
 * The kiosk device protocol (#859), shared by the kiosk endpoints and the
 * kiosk page, so this file has no server-only imports.
 *
 * - The device pairs at `POST /api/kiosk/pair` with `{ code }` and receives
 *   `{ token, kiosk }`. It stores the token in `localStorage` under
 *   `KIOSK_TOKEN_STORAGE_KEY` and nothing else about the kiosk.
 * - Every later kiosk request sends the token in the `x-kiosk-token` header
 *   (never `Authorization: Bearer`, which Better Auth's bearer plugin consumes).
 * - A refused token is answered with 401 and `{ code }`: `kiosk_unknown` (pair
 *   again) or `kiosk_revoked` (show the revoked screen).
 */
export const KIOSK_TOKEN_HEADER = "x-kiosk-token";

export const KIOSK_TOKEN_STORAGE_KEY = "z8.kiosk.deviceToken";

export type KioskRefusalCode = "kiosk_unknown" | "kiosk_revoked";

/**
 * Kiosk clocking (#860). Both calls send the token header and a JSON body with
 * the employee and their PIN; every call checks the PIN again, so the device
 * keeps the PIN only for the few seconds the employee's screen is open.
 *
 * - `POST /api/kiosk/employee-status` with `{ employeeId, pin }` answers the
 *   employee's current state and today's day total (`KioskEmployeeSnapshot`).
 * - `POST /api/kiosk/clock` with `{ employeeId, pin, action, operationId?,
 *   breakMinutes? }` runs the action and answers `KioskClockResult`: the
 *   outcome plus the state and day total after it. `operationId` (a UUID the
 *   device makes once per attempted action) makes a retried request replay
 *   instead of clocking twice; without it the server makes one.
 *
 * Refusals are `{ code, ... }` (`KioskClockRefusal`). A wrong or locked PIN is
 * answered without clocking.
 */
export const KIOSK_CLOCK_ACTIONS = [
	"clock_in",
	"clock_out",
	"break",
	"start_break",
	"resume_break",
] as const;

/**
 * What an employee does at a kiosk. `clock_out` also ends the day while on a
 * break (at the break's start); `break` is a finished break of `breakMinutes`.
 */
export type KioskClockAction = (typeof KIOSK_CLOCK_ACTIONS)[number];

/** An employee's state; instants are UTC ISO strings, shown in the kiosk's zone. */
export type KioskEmployeeState =
	| { status: "clocked_out" }
	| { status: "clocked_in"; workPeriodId: string; since: string }
	| {
			status: "on_break";
			workPeriodId: string;
			since: string;
			breakSince: string;
			/** The zone observed where the break started. */
			breakZone: string;
	  };

/** Today's worked minutes in the kiosk's zone, live work included. */
export type KioskDayTotal = { date: string; timezone: string; todayMinutes: number };

export type KioskEmployeeSnapshot = {
	employee: { id: string; name: string };
	state: KioskEmployeeState;
	dayTotal: KioskDayTotal;
};

export type KioskClockResult = KioskEmployeeSnapshot & {
	outcome: "executed" | "replayed";
	action: KioskClockAction;
};

/**
 * Why a kiosk call did nothing. HTTP status: 400 `invalid_request` (and Clocking's
 * `invalid_command`, `invalid_break_duration`), 401
 * `kiosk_unknown`/`kiosk_revoked`, 403 `employee_not_assigned`, `wrong_pin`,
 * `no_pin`, `access_denied`, 423 `pin_locked`, 429 `rate_limited`, 402
 * `billing_required`, 503 `failed`/`unconfirmed` (only `unconfirmed` may have
 * saved work), and 409 for every other Clocking refusal (for example
 * `already_clocked_in`, `not_clocked_in`, `already_on_break`, `on_break`,
 * `no_break_in_progress`, `holiday_blocked`), which also carries the state.
 */
export type KioskClockRefusal =
	| {
			code: KioskRefusalCode | "invalid_request" | "employee_not_assigned" | "wrong_pin" | "no_pin";
	  }
	| { code: "pin_locked"; lockedUntil: string }
	| { code: "rate_limited"; retryAfter: number }
	| ({ code: string } & Partial<KioskEmployeeSnapshot>);

/** What the device may show about its kiosk. */
export type KioskDeviceInfo = {
	id: string;
	name: string;
	locationId: string;
	locationName: string;
	timezone: string;
	boardEnabled: boolean;
	/** The organization's default language (#862); the kiosk opens in it. */
	language: string;
};

/** One employee on the kiosk home screen (#862). */
export type KioskEmployeeListing = { id: string; name: string };

/**
 * `GET /api/kiosk/employees` (#862): the active employees assigned to the
 * kiosk's location, ordered by name. The device keeps the list only while its
 * home screen shows.
 */
export type KioskEmployeesResponse = { employees: KioskEmployeeListing[] };

/**
 * `GET /api/kiosk/board` (#863): who of the location's assigned employees is
 * in or on break. First name and last initial only, no times, nobody who is out.
 */
export type KioskBoardResponse = {
	enabled: boolean;
	entries: { name: string; state: "in" | "on_break" }[];
};
