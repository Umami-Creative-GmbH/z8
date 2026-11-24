/**
 * The statutory verification seed (#2018): one fictional organization whose employees produce
 * every statutory warning in Scheduling and Staffing, dated around `now`. The CLI
 * (`scripts/seed-statutory-verification.ts`, `pnpm db:seed:statutory-verification`) runs it
 * against a disposable development database; `statutory-verification-seed.integration.test.ts`
 * runs it against the test database. It lives under `__tests__` because it is a fixture, never
 * production code. Raw SQL on purpose, like the statutory test fixtures: the seed must not depend
 * on the code it is used to verify. Timestamps are written as UTC ISO strings, so the result does
 * not depend on the process's time zone.
 */
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Pool, PoolClient } from "pg";
import { Temporal } from "temporal-polyfill";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";

const PREFIX = "stv";
const ORG_ID = `${PREFIX}-org`;
export const STATUTORY_VERIFICATION_ORGANIZATION_ID = ORG_ID;
const TIMEZONE = "Europe/Berlin";
const EMAIL_DOMAIN = "example.test";

type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
const WEEKDAYS: readonly Weekday[] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];

export interface StatutoryVerificationPerson {
	readonly key: string;
	readonly userId: string;
	readonly employeeId: string;
	readonly periodId: string;
	readonly email: string;
	readonly name: string;
}

interface WorkSpec {
	readonly who: StatutoryVerificationPerson;
	readonly date: Temporal.PlainDate;
	readonly start: string;
	readonly end: string;
}

/** The instant of an organization-local wall time; an end at or before the start is the next day. */
function interval(date: Temporal.PlainDate, start: string, end: string) {
	const from = date.toZonedDateTime({ timeZone: TIMEZONE, plainTime: start });
	let to = date.toZonedDateTime({ timeZone: TIMEZONE, plainTime: end });
	if (Temporal.ZonedDateTime.compare(to, from) <= 0) {
		to = date.add({ days: 1 }).toZonedDateTime({ timeZone: TIMEZONE, plainTime: end });
	}
	return { from, to, minutes: from.until(to).total("minutes") };
}

/** A UTC ISO instant: right for `timestamp` (UTC by convention) and `timestamptz` columns alike. */
function utc(value: Temporal.ZonedDateTime): string {
	return value.toInstant().toString();
}

/** `shift.date` is the organization-local midnight, as `upsertShift` stores it. */
function shiftDate(date: Temporal.PlainDate): string {
	return utc(date.toZonedDateTime({ timeZone: TIMEZONE }));
}

function mondayOf(date: Temporal.PlainDate): Temporal.PlainDate {
	return date.subtract({ days: date.dayOfWeek - 1 });
}

/** The next working day (Monday to Friday) at least `days` days after `date`. */
function weekdayAfter(date: Temporal.PlainDate, days: number): Temporal.PlainDate {
	let day = date.add({ days });
	while (day.dayOfWeek > 5) day = day.add({ days: 1 });
	return day;
}

/** Removes what an earlier seed created (the organization cascades; users start with `stv-user-`). */
export async function removeStatutoryVerificationSeed(pool: Pool): Promise<void> {
	await pool.query(`DELETE FROM organization WHERE id = $1`, [ORG_ID]);
	await pool.query(`DELETE FROM "user" WHERE id LIKE $1`, [`${PREFIX}-user-%`]);
}

/** Seeds the organization around `now` (after `removeStatutoryVerificationSeed`); every login uses `password`. */
export async function seedStatutoryVerification(
	pool: Pool,
	options: { readonly password: string; readonly now: Temporal.Instant },
): Promise<StatutoryVerificationPerson[]> {
	const passwordHash = await hashPassword(options.password);
	const now = options.now.toZonedDateTimeISO(TIMEZONE);
	const today = now.toPlainDate();
	const thisMonday = mondayOf(today);
	const lastMonday = thisMonday.subtract({ days: 7 });
	const nextMonday = thisMonday.add({ days: 7 });
	const yearStart = Temporal.PlainDate.from({ year: today.year, month: 1, day: 1 });
	const termsFrom = yearStart.subtract({ years: 1 });
	const nowDate = utc(now);

	// The platform must be configured (a platform admin exists) or every request goes to /setup.
	const { rowCount: platformAdmins } = await pool.query(
		`SELECT 1 FROM "user" WHERE role = 'admin' LIMIT 1`,
	);
	if (!platformAdmins) {
		await pool.query(
			`INSERT INTO "user" (id, name, email, role, email_verified) VALUES ($1, 'Platform Admin', $2, 'admin', true)`,
			[`${PREFIX}-user-platform`, `${PREFIX}-platform@${EMAIL_DOMAIN}`],
		);
	}

	await pool.query(
		`INSERT INTO organization (id, name, slug, created_at, timezone, shifts_enabled, demo_data_enabled, country)
		 VALUES ($1, 'Statutory Verification', $1, now(), $2, true, false, 'DE')`,
		[ORG_ID, TIMEZONE],
	);
	const teamId = randomUUID();
	await pool.query(
		`INSERT INTO team (id, organization_id, name, updated_at) VALUES ($1, $2, 'Store team', now())`,
		[teamId, ORG_ID],
	);

	const people = new Map<string, StatutoryVerificationPerson>();
	async function person(
		key: string,
		input: {
			first: string;
			last: string;
			memberRole: "owner" | "admin" | "member";
			employeeRole: "admin" | "manager" | "employee";
			birthday?: Temporal.PlainDate;
			contractType?: "fixed" | "hourly";
		},
	): Promise<StatutoryVerificationPerson> {
		const userId = `${PREFIX}-user-${key}`;
		const email = `${PREFIX}-${key}@${EMAIL_DOMAIN}`;
		const name = `${input.first} ${input.last}`;
		const employeeId = randomUUID();
		const periodId = randomUUID();
		await pool.query(
			`INSERT INTO "user" (id, name, email, email_verified, first_name, last_name)
			 VALUES ($1, $2, $3, true, $4, $5)`,
			[userId, name, email, input.first, input.last],
		);
		await pool.query(
			`INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at)
			 VALUES ($1, $2, 'credential', $2, $3, now())`,
			[randomUUID(), userId, passwordHash],
		);
		await pool.query(
			`INSERT INTO user_settings (user_id, onboarding_complete, onboarding_completed_at,
				help_improve_product, timezone, week_start_day, time_format, locale, updated_at)
			 VALUES ($1, true, now(), false, $2, 'monday', '24h', 'en', now())`,
			[userId, TIMEZONE],
		);
		await pool.query(
			`INSERT INTO member (id, organization_id, user_id, role, status, created_at)
			 VALUES ($1, $2, $3, $4, 'approved', now())`,
			[randomUUID(), ORG_ID, userId, input.memberRole],
		);
		await pool.query(
			`INSERT INTO employee (id, user_id, organization_id, team_id, role, contract_type, birthday,
				start_date, first_name, last_name, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
			[
				employeeId,
				userId,
				ORG_ID,
				teamId,
				input.employeeRole,
				input.contractType ?? "fixed",
				input.birthday ? `${input.birthday.toString()}T00:00:00Z` : null,
				`${termsFrom.toString()}T00:00:00Z`,
				input.first,
				input.last,
			],
		);
		await pool.query(
			`INSERT INTO team_membership (organization_id, team_id, employee_id, created_by)
			 VALUES ($1, $2, $3, $4)`,
			[ORG_ID, teamId, employeeId, userId],
		);
		await pool.query(
			`INSERT INTO employee_employment_period (id, organization_id, employee_id, status, started_at,
				start_provenance, created_by)
			 VALUES ($1, $2, $3, 'open', $4, 'recorded', $5)`,
			[periodId, ORG_ID, employeeId, utc(termsFrom.toZonedDateTime(TIMEZONE)), userId],
		);
		const created = { key, userId, employeeId, periodId, email, name };
		people.set(key, created);
		return created;
	}

	const admin = await person("admin", {
		first: "Alex",
		last: "Admin",
		memberRole: "owner",
		employeeRole: "admin",
	});
	const planner = await person("planner", {
		first: "Paula",
		last: "Planner",
		memberRole: "member",
		employeeRole: "admin",
	});
	const manager = await person("manager", {
		first: "Max",
		last: "Manager",
		memberRole: "member",
		employeeRole: "manager",
	});
	const miniWarn = await person("mini-warn", {
		first: "Mina",
		last: "Minijob",
		memberRole: "member",
		employeeRole: "employee",
		contractType: "hourly",
	});
	const miniOver = await person("mini-over", {
		first: "Otto",
		last: "Overcap",
		memberRole: "member",
		employeeRole: "employee",
		contractType: "hourly",
	});
	const seasonal = await person("seasonal", {
		first: "Sami",
		last: "Seasonal",
		memberRole: "member",
		employeeRole: "employee",
		contractType: "hourly",
	});
	const student = await person("student", {
		first: "Stella",
		last: "Student",
		memberRole: "member",
		employeeRole: "employee",
		contractType: "hourly",
	});
	const onCall = await person("on-call", {
		first: "Olli",
		last: "Oncall",
		memberRole: "member",
		employeeRole: "employee",
		contractType: "hourly",
	});
	// Turned 16 about three months ago: a minor under JArbSchG all through the planning horizon.
	const apprentice = await person("apprentice", {
		first: "Aylin",
		last: "Apprentice",
		memberRole: "member",
		employeeRole: "employee",
		birthday: today.subtract({ years: 16, months: 3 }),
	});

	await pool.query(`UPDATE team SET primary_manager_id = $1 WHERE id = $2`, [
		manager.employeeId,
		teamId,
	]);

	// ── Employment terms (confirmed, as the monitors read them) ─────────────────────────────────
	async function terms(
		who: StatutoryVerificationPerson,
		values: {
			profile: "regular" | "minijob" | "short_term" | "working_student" | "apprentice";
			hourlyRate?: number;
			weeklyMinutes?: number;
			onCall?: { kind: "exact"; weeklyMinutes: number };
		},
	): Promise<void> {
		const hourly = values.hourlyRate !== undefined;
		await pool.query(
			`INSERT INTO employee_employment_history (employee_id, organization_id, employment_period_id,
				valid_from, valid_from_date, contract_type, hourly_rate, currency, weekly_contract_minutes,
				schedule_source, on_call_hours_kind, on_call_weekly_minutes, employment_profile,
				review_state, created_by, updated_at)
			 VALUES ($1, $2, $3, $4::date, $4, $5, $6, 'EUR', $7, $8, $9, $10, $11, 'confirmed', $12, now())`,
			[
				who.employeeId,
				ORG_ID,
				who.periodId,
				termsFrom.toString(),
				hourly ? "hourly" : "fixed",
				values.hourlyRate ?? null,
				values.onCall ? null : (values.weeklyMinutes ?? null),
				values.onCall ? "on_call" : null,
				values.onCall?.kind ?? null,
				values.onCall?.weeklyMinutes ?? null,
				values.profile,
				admin.userId,
			],
		);
	}

	for (const who of [admin, planner, manager]) {
		await terms(who, { profile: "regular", weeklyMinutes: 2400 });
	}
	await terms(miniWarn, { profile: "minijob", hourlyRate: 15 });
	await terms(miniOver, { profile: "minijob", hourlyRate: 15 });
	await terms(seasonal, { profile: "short_term", hourlyRate: 14 });
	await terms(student, { profile: "working_student", hourlyRate: 16 });
	await terms(onCall, {
		profile: "regular",
		hourlyRate: 14,
		onCall: { kind: "exact", weeklyMinutes: 1200 },
	});
	await terms(apprentice, { profile: "apprentice", weeklyMinutes: 2400 });

	// ── Location, subarea, scoped-manager permissions, templates, coverage ──────────────────────
	const locationId = randomUUID();
	const subareaId = randomUUID();
	await pool.query(
		`INSERT INTO location (id, organization_id, name, created_by, updated_at)
		 VALUES ($1, $2, 'Store', $3, now())`,
		[locationId, ORG_ID, admin.userId],
	);
	await pool.query(
		`INSERT INTO location_subarea (id, location_id, name, created_by, updated_at)
		 VALUES ($1, $2, 'Floor', $3, now())`,
		[subareaId, locationId, admin.userId],
	);
	for (const who of people.values()) {
		await pool.query(
			`INSERT INTO subarea_employee (subarea_id, employee_id, is_primary, created_by)
			 VALUES ($1, $2, $3, $4)`,
			[subareaId, who.employeeId, who === manager, admin.userId],
		);
	}
	const reports = [miniWarn, miniOver, seasonal, student, onCall, apprentice];
	for (const who of reports) {
		await pool.query(
			`INSERT INTO employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 VALUES ($1, $2, true, $3), ($1, $4, false, $3)`,
			[who.employeeId, manager.employeeId, admin.userId, planner.employeeId],
		);
	}
	await pool.query(
		`INSERT INTO team_permissions (employee_id, organization_id, team_id, can_create_teams,
			can_manage_team_members, can_manage_team_settings, can_approve_team_requests, granted_by,
			updated_at)
		 VALUES ($1, $2, $3, false, true, true, true, $4, now())`,
		[manager.employeeId, ORG_ID, teamId, admin.employeeId],
	);
	for (const [name, start, end, color] of [
		["Early", "06:00", "14:00", "#0ea5e9"],
		["Day", "09:00", "15:00", "#22c55e"],
		["Late", "14:00", "22:00", "#f97316"],
	] as const) {
		await pool.query(
			`INSERT INTO shift_template (organization_id, name, start_time, end_time, color, subarea_id,
				created_by, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
			[ORG_ID, name, start, end, color, subareaId, admin.userId],
		);
	}
	for (const day of WEEKDAYS.slice(0, 5)) {
		await pool.query(
			`INSERT INTO coverage_rule (organization_id, subarea_id, day_of_week, start_time, end_time,
				minimum_staff_count, created_by, updated_at)
			 VALUES ($1, $2, $3, '09:00', '15:00', 2, $4, now())`,
			[ORG_ID, subareaId, day, admin.userId],
		);
	}
	await pool.query(
		`INSERT INTO organization_statutory_preference (organization_id) VALUES ($1)
		 ON CONFLICT (organization_id) DO NOTHING`,
		[ORG_ID],
	);
	await pool.query(
		`INSERT INTO organization_tracking_settings (organization_id, tracking_start_date, activated_at,
			activated_by, updated_by)
		 VALUES ($1, $2, now(), $3, $3)`,
		[ORG_ID, termsFrom.toString(), admin.userId],
	);

	// ── Shifts and recorded work ────────────────────────────────────────────────────────────────
	async function shift(input: {
		who: StatutoryVerificationPerson | null;
		date: Temporal.PlainDate;
		start: string;
		end: string;
		status?: "draft" | "published";
		/** When the plan was published / assigned; defaults to 30 days before the shift. */
		announcedAt?: string;
		notes?: string;
	}): Promise<string> {
		const id = randomUUID();
		const status = input.status ?? "published";
		const announcedAt =
			input.announcedAt ??
			utc(input.date.subtract({ days: 30 }).toZonedDateTime({ timeZone: TIMEZONE }));
		await pool.query(
			`INSERT INTO shift (id, organization_id, employee_id, subarea_id, date, start_time, end_time,
				status, published_at, assignment_changed_at, notes, created_by, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $10, $10)`,
			[
				id,
				ORG_ID,
				input.who?.employeeId ?? null,
				subareaId,
				shiftDate(input.date),
				input.start,
				input.end,
				status,
				status === "published" ? announcedAt : null,
				announcedAt,
				input.notes ?? null,
				planner.userId,
			],
		);
		return id;
	}

	const work: WorkSpec[] = [];
	/** Work before today is recorded as worked; today's and later work is a published shift. */
	async function planOrWork(spec: WorkSpec): Promise<void> {
		const { to } = interval(spec.date, spec.start, spec.end);
		if (Temporal.Instant.compare(to.toInstant(), now.toInstant()) < 0) work.push(spec);
		await shift({ who: spec.who, date: spec.date, start: spec.start, end: spec.end });
	}

	// Minijob: 4-hour days from the 1st of this month. 35 h × 15 EUR = 525 EUR (87 % of 603 EUR);
	// 46 h = 690 EUR, above the cap.
	const monthStart = today.with({ day: 1 });
	for (const [who, minutes] of [
		[miniWarn, 35 * 60],
		[miniOver, 46 * 60],
	] as const) {
		let left = minutes;
		for (let day = monthStart; left > 0; day = day.add({ days: 1 })) {
			const chunk = Math.min(240, left);
			const end = Temporal.PlainTime.from("08:00").add({ minutes: chunk }).toString().slice(0, 5);
			await planOrWork({ who, date: day, start: "08:00", end });
			left -= chunk;
		}
	}

	// Short-term: 55 working days at a prior employer this year, plus six Mondays and Tuesdays here:
	// 61 of 70 working days. Those of the last two weeks and this week; only days of this calendar
	// year count, so early in January the missing ones move to the following weeks.
	await pool.query(
		`INSERT INTO employee_statutory_offset (organization_id, employee_id, offset_kind,
			valid_from_date, valid_until_date, count_value, note, created_by)
		 VALUES ($1, $2, 'prior_short_term_work_days', $3, $4, 55, 'Prior employer certificate', $5)`,
		[
			ORG_ID,
			seasonal.employeeId,
			yearStart.toString(),
			yearStart.add({ years: 1 }).toString(),
			admin.userId,
		],
	);
	let seasonalDays = 0;
	for (
		let monday = thisMonday.subtract({ weeks: 2 });
		seasonalDays < 6;
		monday = monday.add({ weeks: 1 })
	) {
		for (const offset of [0, 1]) {
			const date = monday.add({ days: offset });
			if (date.year !== today.year || seasonalDays === 6) continue;
			await planOrWork({ who: seasonal, date, start: "09:00", end: "15:00" });
			seasonalDays++;
		}
	}

	// Working student: no lecture-free period around now. Last week 14:00–18:30 on weekdays
	// (22.5 h, of which 20 h fall in the default 06:00–18:00 band: the band decides whether the
	// week is over 20 h). This week and next week 09:00–14:00 Monday to Thursday (20 h), plus
	// Friday this week (25 h, over 20 h). 20 earlier weeks over 20 h at a prior employer.
	for (let index = 0; index < 5; index++) {
		await planOrWork({
			who: student,
			date: lastMonday.add({ days: index }),
			start: "14:00",
			end: "18:30",
		});
	}
	for (const monday of [thisMonday, nextMonday]) {
		for (let index = 0; index < (monday === thisMonday ? 5 : 4); index++) {
			await planOrWork({
				who: student,
				date: monday.add({ days: index }),
				start: "09:00",
				end: "14:00",
			});
		}
	}
	await pool.query(
		`INSERT INTO employee_statutory_offset (organization_id, employee_id, offset_kind,
			valid_from_date, valid_until_date, count_value, note, created_by)
		 VALUES ($1, $2, 'prior_working_student_over_20h_weeks', $3, $4, 20, 'Prior employer statement', $5)`,
		[
			ORG_ID,
			student.employeeId,
			thisMonday.subtract({ weeks: 30 }).toString(),
			thisMonday.subtract({ weeks: 10 }).toString(),
			admin.userId,
		],
	);
	await pool.query(
		`INSERT INTO employee_study_period (organization_id, employee_id, period_kind, starts_on,
			ends_on, note, created_by)
		 VALUES ($1, $2, 'lecture_free', $3, $4, 'Semester break', $5)`,
		[
			ORG_ID,
			student.employeeId,
			thisMonday.add({ weeks: 8 }).toString(),
			thisMonday.add({ weeks: 14 }).subtract({ days: 1 }).toString(),
			admin.userId,
		],
	);

	// On-call (exactly 20 h a week): 13 reference weeks of Tuesday and Thursday 08:00–13:00 work,
	// own sick leave on Wednesday and Thursday last week, and a shift two working days ahead that
	// was announced just now (short notice, § 12 Abs. 3 TzBfG: at least four days).
	for (let week = 13; week >= 1; week--) {
		const monday = thisMonday.subtract({ weeks: week });
		for (const offset of [1, 3]) {
			const date = monday.add({ days: offset });
			if (week === 1 && offset === 3) continue; // sick
			await planOrWork({ who: onCall, date, start: "08:00", end: "13:00" });
		}
	}
	const sickCategoryId = randomUUID();
	await pool.query(
		`INSERT INTO absence_category (id, organization_id, type, name, requires_work_time, updated_at)
		 VALUES ($1, $2, 'sick', 'Sick leave', false, now())`,
		[sickCategoryId, ORG_ID],
	);
	await pool.query(
		`INSERT INTO absence_entry (employee_id, organization_id, category_id, start_date, end_date,
			status, sick_detail, approved_by, approved_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, 'approved', 'with_certificate', $6, now(), now())`,
		[
			onCall.employeeId,
			ORG_ID,
			sickCategoryId,
			lastMonday.add({ days: 2 }).toString(),
			lastMonday.add({ days: 3 }).toString(),
			admin.employeeId,
		],
	);
	await shift({
		who: onCall,
		date: weekdayAfter(today, 2),
		start: "08:00",
		end: "12:00",
		announcedAt: nowDate,
		notes: "Short notice",
	});

	// Apprentice (16): a full vocational-school day (6 lessons) and an exam next week, each with a
	// draft shift on it, plus draft night (until 22:30) and Saturday shifts in each of the next
	// four weeks, so the JArbSchG publish block can be tried on and off more than once.
	const schoolDay = nextMonday.add({ days: 1 });
	const examDay = nextMonday.add({ days: 3 });
	await pool.query(
		`INSERT INTO employee_apprentice_release (organization_id, employee_id, release_kind, starts_on,
			ends_on, lesson_count, created_by)
		 VALUES ($1, $2, 'vocational_school_day', $3, $3, 6, $4)`,
		[ORG_ID, apprentice.employeeId, schoolDay.toString(), admin.userId],
	);
	await pool.query(
		`INSERT INTO employee_apprentice_release (organization_id, employee_id, release_kind, starts_on,
			ends_on, school_minutes, exam_start_time, created_by)
		 VALUES ($1, $2, 'exam_day', $3, $3, 180, '09:00', $4)`,
		[ORG_ID, apprentice.employeeId, examDay.toString(), admin.userId],
	);
	for (const date of [schoolDay, examDay]) {
		await shift({ who: apprentice, date, start: "08:00", end: "16:00", status: "draft" });
	}
	for (let week = 1; week <= 4; week++) {
		const monday = thisMonday.add({ weeks: week });
		await shift({
			who: apprentice,
			date: monday.add({ days: 2 }),
			start: "15:00",
			end: "22:30",
			status: "draft",
			notes: "Night",
		});
		await shift({
			who: apprentice,
			date: monday.add({ days: 5 }),
			start: "10:00",
			end: "14:00",
			status: "draft",
			notes: "Saturday",
		});
	}
	// Ordinary published weekday shifts this week (no finding on their own).
	for (let index = 0; index < 5; index++) {
		await planOrWork({
			who: apprentice,
			date: thisMonday.add({ days: index }),
			start: "08:00",
			end: "14:00",
		});
	}

	// An open shift for Staffing suggestions: proposing the working student pushes their week
	// further over 20 h, proposing a Minijobber pushes the month over the cap.
	await shift({
		who: null,
		date: weekdayAfter(today, 1),
		start: "10:00",
		end: "16:00",
		notes: "Open shift for Staffing",
	});

	await recordWork(pool, work);
	return [...people.values()];
}

async function recordWork(pool: Pool, specs: readonly WorkSpec[]): Promise<void> {
	await withCanonicalRecords(pool, async (client: PoolClient) => {
		for (const spec of specs) {
			const { from, to, minutes } = interval(spec.date, spec.start, spec.end);
			const clockInId = randomUUID();
			await client.query(
				`INSERT INTO time_entry (id, employee_id, organization_id, type, timestamp,
					utc_offset_minutes, timezone, timezone_source, hash, created_by, created_at)
				 VALUES ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
				[
					clockInId,
					spec.who.employeeId,
					ORG_ID,
					utc(from),
					from.offsetNanoseconds / 60_000_000_000,
					TIMEZONE,
					`${PREFIX}-${clockInId}`,
					spec.who.userId,
				],
			);
			await client.query(
				`INSERT INTO work_period (id, employee_id, organization_id, clock_in_id, start_time,
					end_time, duration_minutes, is_active, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, false, $5)`,
				[randomUUID(), spec.who.employeeId, ORG_ID, clockInId, utc(from), utc(to), minutes],
			);
		}
	});
}
