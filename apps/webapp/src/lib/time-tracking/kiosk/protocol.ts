/**
 * The kiosk device protocol (#859), shared by the kiosk endpoints and the
 * kiosk page, so this file has no server-only imports.
 *
 * - The device pairs at `POST /api/kiosk/pair` with `{ code }` and receives
 *   `{ token, kiosk }`. It stores the token in `localStorage` under
 *   `KIOSK_TOKEN_STORAGE_KEY`. Without offline mode it stores nothing else
 *   about the kiosk; with offline mode (#1291) it also caches the kiosk, its
 *   employees and their states in its own IndexedDB (`offline-cache.ts`), and
 *   queues frozen kiosk commands there while offline (`offline-queue.ts`, #1292).
 * - Every later kiosk request sends the token in the `x-kiosk-token` header
 *   (never `Authorization: Bearer`, which Better Auth's bearer plugin consumes).
 * - A refused token is answered with 401 and `{ code }`: `kiosk_unknown` (pair
 *   again) or `kiosk_revoked` (show the revoked screen).
 */
import type { WorkVehicleOption, WorkVehicleUse } from "../vehicle-use/work-vehicle-use";
import type { KioskContactAnchor } from "./frozen-command";
import type { KioskSealingKey } from "./pin-seal";

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
 *   breakMinutes?, vehicleUse? }` runs the action and answers `KioskClockResult`: the
 *   outcome, when it took effect, and the state and day total after it. `operationId` (a UUID the
 *   device makes once per attempted action) makes a retried request replay
 *   instead of clocking twice; without it the server makes one.
 *   `vehicleUse` (#1123) is the web clock's (#1122): on `clock_in` the vehicle
 *   and start reading, on `clock_out` the end reading or distance (or the whole
 *   vehicle use when the work records none), on `resume_break` and `break` one
 *   `{ readingKm }`. It never refuses the action: what cannot be recorded is
 *   dropped. `start_break` carries none; the break's reading is asked on resume.
 * - Project and work category (#887): `clock_out` may carry `project` and
 *   `workCategory` (`KioskAttributionValue`): absent keeps the work's, `null`
 *   clears it, an ID replaces it. Every other action refuses them (400
 *   `invalid_request`). Clocking checks a replacement against the employee's
 *   booking eligibility before anything is written: 409 `project_not_allowed`
 *   or `work_category_not_allowed`, with the state, records nothing.
 *
 * Refusals are `{ code, ... }` (`KioskClockRefusal`). A wrong or locked PIN is
 * answered without clocking.
 *
 * Badges (#1366, spec #889): at a kiosk whose `badgeScannerEnabled` is on, both
 * calls take `{ badge }` (the scanned credential, `badge-credential.ts`) instead
 * of `{ employeeId, pin }`; the badge names the employee. `clock` may repeat
 * the snapshot's `employeeId` beside it, which must be the badge's own. A badge
 * is never stored on the device and never queued offline. Badge refusals: 403
 * `badge_input_disabled` (the kiosk does not accept badges), 403
 * `badge_not_accepted` (unknown, replaced, revoked, foreign or ended badge, an
 * inactive or unassigned employee, or another `employeeId`; it names nobody),
 * 429 `rate_limited` (the kiosk's own badge limit, never the PIN's). A badge
 * action whose authority ended after the scan is refused the same way.
 *
 * Camera (#1367): a badge the kiosk read with its own camera is sent the same
 * way with `badgeInput: "camera"`; without `badgeInput` (or with `"scanner"`) it
 * came from the attached scanner. Each input counts only while its own switch
 * is on (`badgeScannerEnabled`, `badgeCameraEnabled`); the other input's call is
 * answered 403 `badge_input_disabled`. Only the decoded text is sent: no image
 * ever leaves the device.
 */
export const KIOSK_BADGE_INPUTS = ["scanner", "camera"] as const;

/** Which of a kiosk's badge inputs read a badge (#1366, #1367). */
export type KioskBadgeInput = (typeof KIOSK_BADGE_INPUTS)[number];

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

/**
 * The employee's day total (Time Tracking glossary): their work within the
 * local day `date` in their timezone, as the web counts it, live work included.
 */
export type KioskDayTotal = { date: string; timezone: string; minutes: number };

/**
 * What the kiosk asks about vehicle use (#1123, spec #807), as the web clock
 * does (#1121, #1122): the employee's mode, the vehicles to pick with their
 * assigned ones first, each vehicle's last recorded end reading (before the live
 * work started, while clocked in), the organization vehicles on another
 * employee's live work, and the live work's recorded vehicle use. The kiosk
 * pre-fills and warns from these facts alone, so asking costs no PIN attempts.
 */
export type KioskVehicleUse = {
	mode: "asked" | "expected";
	vehicles: WorkVehicleOption[];
	suggestedVehicleIds: string[];
	lastEndKmByVehicleId: Record<string, number>;
	vehiclesOnOtherLiveWork: string[];
	live: WorkVehicleUse | null;
};

/** A project or work category as the kiosk shows it (#887). */
export type KioskAttributionOption = { id: string; name: string };

/**
 * One attribution field at an online clock-out (#887): what the live work is
 * booked to now (`current`, null for none; it may no longer be offered) and the
 * choices the employee's booking eligibility offers, the shared rule Clocking
 * checks again when the work ends.
 */
export type KioskAttributionField = {
	current: KioskAttributionOption | null;
	options: KioskAttributionOption[];
};

/**
 * What the kiosk asks at an online clock-out (#887): each field only while there
 * is something to decide (a choice, or a current value to clear). `project` is
 * absent while the organization has projects off.
 */
export type KioskAttribution = {
	project?: KioskAttributionField;
	workCategory?: KioskAttributionField;
};

/**
 * The clock-out's choice for one field (#887), sent beside `action: "clock_out"`
 * only: absent keeps the work's attribution, `null` clears it, an ID replaces it.
 */
export type KioskAttributionValue = string | null;

export type KioskEmployeeSnapshot = {
	employee: { id: string; name: string };
	state: KioskEmployeeState;
	dayTotal: KioskDayTotal;
	/**
	 * Only `POST /api/kiosk/employee-status` answers it, and only while vehicle
	 * use is asked or expected for the employee: without it the kiosk asks nothing.
	 */
	vehicleUse?: KioskVehicleUse;
	/**
	 * Only `POST /api/kiosk/employee-status` answers it, only while the employee
	 * is clocked in (not on a break) and has something to decide (#887): without
	 * it the clock-out asks nothing. Never cached for offline use.
	 */
	attribution?: KioskAttribution;
};

/**
 * When the action took effect, sampled by the server (a UTC ISO instant), and
 * the zone to show it in. A day ended on a break ends at the break's start.
 */
export type KioskEventTime = { instant: string; zone: string };

export type KioskClockResult = KioskEmployeeSnapshot & {
	outcome: "executed" | "replayed";
	action: KioskClockAction;
	at: KioskEventTime;
};

/**
 * Resolving an uncertain online action (#1363, spec #889). Every explicit
 * action gets one `operationId`, made before it is sent and never replaced for
 * that action. When its reply is lost (no answer, a 5xx, an answer that is not
 * Z8's), the device must not act again or claim that nothing was recorded; it
 * asks `POST /api/kiosk/clock/outcome` with `{ operationId, employeeId, action }`
 * (the action as it was sent) and only the device token, no PIN or badge:
 *
 * - `committed`: the action was recorded; `at` is its original event time, as
 *   its own reply would have said. Show it once.
 * - `not_recorded`: nothing was recorded, and the attempt is now closed for
 *   good: the original request can never commit later. Only a fresh, explicit
 *   action (under current authorization) may follow; never resend the old one.
 * - `conflict`: the operation was recorded for another employee or action.
 *   Nothing about it is disclosed.
 *
 * Any other answer (401, 5xx, no connection) settles nothing: keep the turn
 * unresolved and ask again. The lookup never runs, retries or queues an action.
 * Asking while the original is still in flight can close it as not recorded
 * (safe, never false), so the device waits a few seconds before it asks.
 * A refused original then answers 409 `attempt_closed`.
 */
export type KioskClockAttemptOutcome =
	| { outcome: "committed"; action: KioskClockAction; at: KioskEventTime }
	| { outcome: "not_recorded" }
	| { outcome: "conflict" };

/**
 * Why a kiosk call did nothing. HTTP status: 400 `invalid_request` (and Clocking's
 * `invalid_command`, `invalid_break_duration`), 401
 * `kiosk_unknown`/`kiosk_revoked`, 403 `employee_not_assigned`, `wrong_pin`,
 * `no_pin`, `access_denied`, 423 `pin_locked`, 429 `rate_limited`, 402
 * `billing_required`, 503 `failed`/`unconfirmed` (only `unconfirmed` may have
 * saved work), and 409 for every other Clocking refusal (for example
 * `already_clocked_in`, `not_clocked_in`, `already_on_break`, `on_break`,
 * `no_break_in_progress`, `holiday_blocked`, and `attempt_closed`: the kiosk's
 * outcome lookup already closed this operation as not recorded), which also
 * carries the state.
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
	/**
	 * Whether the kiosk works offline (#1287, spec #885): its offline-mode switch
	 * is on and its organization is adopted. Read at every contact (session and
	 * pairing), so switching it off reaches the kiosk at its next request. While
	 * false the kiosk caches and queues nothing and refuses clocking offline.
	 */
	offlineMode: boolean;
	/**
	 * Whether the kiosk accepts employee kiosk badges from an attached
	 * keyboard-style QR scanner on its home screen (#1366, spec #889), off by
	 * default. Read at every contact. Absent (a device that cached an older
	 * answer) reads as off. Badge clocking always needs a connection.
	 */
	badgeScannerEnabled?: boolean;
	/**
	 * Whether the kiosk's home screen offers "Scan badge" with its own camera
	 * (#1367), off by default and independent of the scanner. Read at every
	 * contact; absent reads as off.
	 */
	badgeCameraEnabled?: boolean;
	/**
	 * Whether the kiosk accepts kiosk fobs from an attached keyboard-style NFC
	 * reader on its home screen (#1505, spec #1358), off by default and
	 * independent of both badge inputs. Read at every contact; absent reads as
	 * off. Fobs always need a connection.
	 */
	nfcFobReaderEnabled?: boolean;
};

/**
 * Kiosk fobs (#1505, spec #1358, ADR 0014). A fob's chip serial number
 * (`fob-serial.ts`) selects an employee; their kiosk PIN still proves. Both
 * calls send the token header and need the kiosk's `nfcFobReaderEnabled`
 * (else 403 `fob_reader_disabled`). A serial number that is no 4, 7 or 10-byte
 * hex number is 400 `invalid_serial`. Online only: nothing is queued.
 *
 * - `POST /api/kiosk/fob` with `{ serial }` answers `KioskFobLookup`, limited
 *   per kiosk (429 `rate_limited`). It records nothing.
 * - `POST /api/kiosk/fob/registration` with `{ serial, employeeId, pin }`
 *   links the fob to the employee after their kiosk PIN, which counts toward
 *   the per-kiosk PIN limit and the employee's lockout exactly like clocking
 *   (403 `wrong_pin`/`no_pin`, 423 `pin_locked`, 429 `rate_limited`). Refusals:
 *   403 `employee_not_eligible` (not active and assigned to the kiosk's
 *   location), 409 `fob_linked_to_other_employee` (names nobody). Answers
 *   `KioskFobRegistrationResult`.
 */
export type KioskFobLookup =
	/** An active fob of an employee eligible at this kiosk (the kiosk's name list). */
	| { outcome: "employee"; employee: KioskEmployeeListing }
	/** Everything else, alike: unknown, ended, another organization's or location's, inactive or departed. */
	| { outcome: "not_recognised" };

export type KioskFobRegistrationResult = {
	/** `already_registered`: the fob was already this employee's; nothing changed. */
	outcome: "registered" | "already_registered";
	employee: KioskEmployeeListing;
	/** The last four hex digits of the serial number, the only part ever shown. */
	lastFour: string;
	/** Whether the registration ended the employee's earlier fob. */
	replaced: boolean;
};

/**
 * What a kiosk needs to queue frozen kiosk commands while offline (#1289, spec
 * #885). `GET /api/kiosk/session` and `POST /api/kiosk/pair` answer it as
 * `offline` beside `kiosk`, only while `kiosk.offlineMode` is true:
 * - `contact`: the signed anchor of this contact. `contact.serverTime` is Z8's
 *   time now (UTC ISO); the kiosk measures elapsed time from it with a monotonic
 *   clock (`server_anchor`) and returns the latest anchor with every command it
 *   queues until its next contact.
 * - `sealingKey`: Z8's public key to seal each entered PIN with (`pin-seal.ts`).
 * Frozen commands go to `POST /api/kiosk/commands`; see `frozen-command.ts`.
 */
export type KioskOfflineContact = {
	contact: KioskContactAnchor;
	sealingKey: KioskSealingKey;
};

/** `GET /api/kiosk/session`. */
export type KioskSessionResponse = { kiosk: KioskDeviceInfo; offline?: KioskOfflineContact };

/** `POST /api/kiosk/pair`. */
export type KioskPairResponse = KioskSessionResponse & { token: string };

/** One employee on the kiosk home screen (#862). */
export type KioskEmployeeListing = { id: string; name: string };

/**
 * What an offline-mode kiosk caches at each contact (#1291, spec #885): each
 * listed employee's state, keyed by employee id, and the server instant it was
 * read at (UTC ISO), shown offline as "as of HH:MM". Never a day total.
 */
export type KioskOfflineStates = {
	learnedAt: string;
	states: Record<string, KioskEmployeeState>;
	/**
	 * The vehicle use each listed employee is asked (#1292), keyed by employee id,
	 * only for those whose vehicle use is asked or expected: what the vehicle step
	 * needs offline, where no live PIN check can fetch it. Absent when nobody has one.
	 */
	vehicleUse?: Record<string, KioskVehicleUse>;
};

/**
 * `GET /api/kiosk/employees` (#862): the active employees assigned to the
 * kiosk's location, ordered by name. A kiosk without offline mode keeps the
 * list only while its home screen shows. An offline-mode kiosk (#1291) also
 * gets `offline`, and keeps both until its next contact replaces or clears them.
 */
export type KioskEmployeesResponse = {
	employees: KioskEmployeeListing[];
	offline?: KioskOfflineStates;
};

/**
 * `GET /api/kiosk/board` (#863): who of the location's assigned employees is
 * in or on break. First name and last initial only, no times, nobody who is out.
 */
export type KioskBoardResponse = {
	enabled: boolean;
	entries: { name: string; state: "in" | "on_break" }[];
};
