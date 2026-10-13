/**
 * PostgreSQL contract for first employment terms (#1178): an employee who
 * starts on an hourly contract with a wage starts with confirmed hourly terms,
 * written in the same transaction as the employee, and their report pays them.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { db as rootDatabase } from "@/db";
import { ensureEmployeeForOrganizationMember } from "@/lib/auth/organization-member-provisioning";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { createDepartureClockOut } from "@/lib/employee-lifecycle/clock-out";
import { createDepartureCommands } from "@/lib/employee-lifecycle/commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { generateEmployeeReport } from "@/lib/reports/report-generator";
import { writeFirstEmploymentTerms } from "./first-terms";

// The report's schedule-based expected hours are not under test.
vi.mock("@/lib/effect/runtime", () => ({
	runtime: {
		runPromise: async () => ({ totalMinutes: 0, workDays: 0, scheduleInfo: null }),
	},
}));
vi.mock("@/lib/time-tracking/calculations", () => ({
	calculateExpectedWorkHoursForEmployee: () => null,
}));

const termsWrite = vi.hoisted(() => ({ fail: false }));
vi.mock("./write-terms", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./write-terms")>();
	const writeEmploymentTerms: typeof actual.writeEmploymentTerms = async (tx, input) => {
		if (termsWrite.fail) throw new Error("terms write failed");
		return actual.writeEmploymentTerms(tx, input);
	};
	return { ...actual, writeEmploymentTerms };
});

type TermsRow = {
	valid_from: Date;
	valid_until: Date | null;
	status: string;
	contract_type: string;
	weekly_contract_minutes: number;
	work_model: string;
	work_policy_id: string | null;
	hourly_rate: string | null;
	currency: string;
	review_state: string;
	employment_period_id: string | null;
	created_by: string;
};

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("first employment terms", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let ownerUserId: string;
	const userIds: string[] = [];

	async function termsOf(employeeId: string): Promise<TermsRow[]> {
		const { rows } = await fixture.pool.query<TermsRow>(
			`select valid_from, valid_until, status, contract_type, weekly_contract_minutes, work_model,
			        work_policy_id, hourly_rate::text, currency, review_state, employment_period_id, created_by
			 from employee_employment_history where employee_id = $1 order by valid_from`,
			[employeeId],
		);
		return rows;
	}

	async function one<T>(sql: string, params: unknown[]) {
		return (await fixture.pool.query(sql, params)).rows[0] as T;
	}

	async function newOrganization(timezone = "UTC") {
		const id = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = $2 where id = $1", [id, timezone]);
		const owner = await fixture.seedEmployee({ organizationId: id, role: "owner" });
		return { id, owner };
	}

	/** An accepted invitation and the employee draft an org admin prepared for it. */
	async function invite(input: {
		organizationId: string;
		inviterId: string;
		userId?: string;
		contractType: "fixed" | "hourly";
		hourlyRate: string | null;
		startDate: Date | null;
	}) {
		let userId = input.userId;
		if (!userId) {
			userId = randomUUID();
			userIds.push(userId);
			await fixture.pool.query(
				`insert into "user" (id, name, email, created_at, updated_at)
				 values ($1, 'Invitee', $2, now(), now())`,
				[userId, `${userId}@first-terms.test`],
			);
			await fixture.pool.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, 'member', 'approved', now())`,
				[randomUUID(), input.organizationId, userId],
			);
		}
		const { email } = await one<{ email: string }>(`select email from "user" where id = $1`, [
			userId,
		]);
		const invitationId = randomUUID();
		await fixture.pool.query(
			`insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id)
			 values ($1, $2, $3, 'member', 'accepted', now() + interval '1 day', $4)`,
			[invitationId, input.organizationId, email, input.inviterId],
		);
		await fixture.pool.query(
			`insert into employee_invitation_draft
			 (invitation_id, organization_id, normalized_email, role, contract_type, current_hourly_rate,
			  start_date, updated_by)
			 values ($1, $2, $3, 'employee', $4, $5, $6, $7)`,
			[
				invitationId,
				input.organizationId,
				email.toLowerCase(),
				input.contractType,
				input.hourlyRate,
				input.startDate,
				input.inviterId,
			],
		);
		return { userId, invitationId };
	}

	function accept(input: { organizationId: string; userId: string; invitationId: string }) {
		return ensureEmployeeForOrganizationMember(fixture.db as typeof rootDatabase, {
			mode: "membershipAccepted",
			memberRole: "member",
			...input,
		});
	}

	async function employeeOf(organizationId: string, userId: string) {
		const { rows } = await fixture.pool.query<{ id: string; is_active: boolean }>(
			"select id, is_active from employee where organization_id = $1 and user_id = $2",
			[organizationId, userId],
		);
		return rows[0] ?? null;
	}

	/** Completed work, recorded at UTC. */
	async function work(input: {
		organizationId: string;
		employeeId: string;
		userId: string;
		start: string;
		end: string;
		minutes: number;
	}) {
		const clockInId = randomUUID();
		const clockOutId = randomUUID();
		for (const [entryId, type, timestamp] of [
			[clockInId, "clock_in", input.start],
			[clockOutId, "clock_out", input.end],
		]) {
			await fixture.pool.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
				  timezone_source, hash, created_by)
				 values ($1, $2, $3, $4, $5, 0, null, 'user_setting', $7, $6)`,
				[entryId, input.employeeId, input.organizationId, type, timestamp, input.userId, entryId],
			);
		}
		await fixture.pool.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
			  duration_minutes, is_active, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, false, now())`,
			[
				input.employeeId,
				input.organizationId,
				clockInId,
				clockOutId,
				input.start,
				input.end,
				input.minutes,
			],
		);
	}

	function report(input: {
		organizationId: string;
		employeeId: string;
		startDate: string;
		endDate: string;
		timezone: string;
	}) {
		return generateEmployeeReport(
			input.employeeId,
			input.organizationId,
			new Date(`${input.startDate}T00:00:00Z`),
			new Date(`${input.endDate}T23:59:59Z`),
			{ startDate: input.startDate, endDate: input.endDate, timezone: input.timezone },
		);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = fixture.organizationId;
		ownerUserId = fixture.ownerUserId;
	});

	beforeEach(() => {
		termsWrite.fail = false;
	});

	afterAll(async () => {
		await fixture?.close();
		if (userIds.length > 0) {
			await fixture?.pool.query(`delete from "user" where id = any($1::text[])`, [userIds]);
		}
	});

	describe("the first terms command", () => {
		it("writes confirmed hourly terms with the terms form defaults from the start date", async () => {
			const target = await fixture.seedEmployee();

			await fixture.db.transaction((tx) =>
				writeFirstEmploymentTerms(tx, {
					organizationId,
					employeeId: target.employeeId,
					actorUserId: ownerUserId,
					contractType: "hourly",
					hourlyRate: 30,
					startDate: day("2026-03-01"),
				}),
			);

			expect(await termsOf(target.employeeId)).toEqual([
				{
					valid_from: day("2026-03-01"),
					valid_until: null,
					status: "active",
					contract_type: "hourly",
					weekly_contract_minutes: 2400,
					work_model: "onsite",
					work_policy_id: null,
					hourly_rate: "30.00",
					currency: "EUR",
					review_state: "confirmed",
					employment_period_id: target.employmentPeriodId,
					created_by: ownerUserId,
				},
			]);
		});

		it("starts on the organization's today when there is no start date", async () => {
			// 12:00 UTC on 5 October is already 6 October on Kiritimati (UTC+14).
			const org = await newOrganization("Pacific/Kiritimati");
			const target = await fixture.seedEmployee({ organizationId: org.id });

			await fixture.db.transaction((tx) =>
				writeFirstEmploymentTerms(tx, {
					organizationId: org.id,
					employeeId: target.employeeId,
					actorUserId: org.owner.userId,
					contractType: "hourly",
					hourlyRate: 30,
					startDate: null,
					now: new Date("2026-10-05T12:00:00Z"),
				}),
			);

			const [terms] = await termsOf(target.employeeId);
			expect(terms?.valid_from).toEqual(day("2026-10-06"));
		});

		it("reads a start instant as the organization's calendar date", async () => {
			// 23:30 UTC on 28 February is 1 March in Berlin.
			const org = await newOrganization("Europe/Berlin");
			const target = await fixture.seedEmployee({ organizationId: org.id });

			await fixture.db.transaction((tx) =>
				writeFirstEmploymentTerms(tx, {
					organizationId: org.id,
					employeeId: target.employeeId,
					actorUserId: org.owner.userId,
					contractType: "hourly",
					hourlyRate: 30,
					startDate: new Date("2026-02-28T23:30:00Z"),
				}),
			);

			const [terms] = await termsOf(target.employeeId);
			expect(terms?.valid_from).toEqual(day("2026-03-01"));
		});

		it.each([
			["a fixed contract", "fixed" as const, 30],
			["an hourly contract without a wage", "hourly" as const, null],
		])("writes no terms for %s", async (_case, contractType, hourlyRate) => {
			const target = await fixture.seedEmployee();

			const written = await fixture.db.transaction((tx) =>
				writeFirstEmploymentTerms(tx, {
					organizationId,
					employeeId: target.employeeId,
					actorUserId: ownerUserId,
					contractType,
					hourlyRate,
					startDate: day("2026-03-01"),
				}),
			);

			expect(written).toBeNull();
			expect(await termsOf(target.employeeId)).toEqual([]);
		});
	});

	describe("invitation acceptance", () => {
		it("gives a new hourly employee first terms from the draft, and their report pays them", async () => {
			const invited = await invite({
				organizationId,
				inviterId: ownerUserId,
				contractType: "hourly",
				hourlyRate: "42.50",
				startDate: day("2026-03-01"),
			});

			await accept({ organizationId, ...invited });

			const employee = await employeeOf(organizationId, invited.userId);
			expect(employee?.is_active).toBe(true);
			const terms = await termsOf(employee!.id);
			expect(terms).toMatchObject([
				{
					valid_from: day("2026-03-01"),
					valid_until: null,
					contract_type: "hourly",
					hourly_rate: "42.50",
					currency: "EUR",
					review_state: "confirmed",
					created_by: ownerUserId,
				},
			]);
			expect(terms[0]?.employment_period_id).not.toBeNull();

			await work({
				organizationId,
				employeeId: employee!.id,
				userId: invited.userId,
				start: "2026-03-10T08:00:00Z",
				end: "2026-03-10T10:00:00Z",
				minutes: 120,
			});
			const result = await report({
				organizationId,
				employeeId: employee!.id,
				startDate: "2026-03-01",
				endDate: "2026-03-31",
				timezone: "UTC",
			});
			expect(result.hourlyEarnings).toMatchObject({
				totalHours: 2,
				totalEarnings: 85,
				currency: "EUR",
			});
		});

		it("gives a reactivated hourly employee first terms in their open employment", async () => {
			const returning = await fixture.seedEmployee({ isActive: false });
			const invited = await invite({
				organizationId,
				inviterId: ownerUserId,
				userId: returning.userId,
				contractType: "hourly",
				hourlyRate: "31.00",
				startDate: day("2026-10-01"),
			});

			await accept({ organizationId, ...invited });

			expect((await employeeOf(organizationId, returning.userId))?.is_active).toBe(true);
			expect(await termsOf(returning.employeeId)).toMatchObject([
				{
					valid_from: day("2026-10-01"),
					contract_type: "hourly",
					hourly_rate: "31.00",
					review_state: "confirmed",
					employment_period_id: returning.employmentPeriodId,
				},
			]);
		});

		it("gives a new fixed employee no terms", async () => {
			const invited = await invite({
				organizationId,
				inviterId: ownerUserId,
				contractType: "fixed",
				hourlyRate: null,
				startDate: day("2026-03-01"),
			});

			await accept({ organizationId, ...invited });

			const employee = await employeeOf(organizationId, invited.userId);
			expect(employee?.is_active).toBe(true);
			expect(await termsOf(employee!.id)).toEqual([]);
		});

		it("creates no employee when the terms write fails", async () => {
			const invited = await invite({
				organizationId,
				inviterId: ownerUserId,
				contractType: "hourly",
				hourlyRate: "42.50",
				startDate: day("2026-03-01"),
			});
			termsWrite.fail = true;

			await expect(accept({ organizationId, ...invited })).rejects.toThrow("terms write failed");

			expect(await employeeOf(organizationId, invited.userId)).toBeNull();
			expect(
				await one<{ count: number }>(
					"select count(*)::int as count from employee_invitation_draft where invitation_id = $1",
					[invited.invitationId],
				),
			).toEqual({ count: 1 });
		});
	});

	describe("ended employment and rehire", () => {
		const AFTER_CUTOFF = parseInstant("2026-09-14T22:17:00Z");
		const REHIRED_AT = parseInstant("2026-10-05T08:00:00Z");

		it("keeps an ended hourly employee inactive without terms when the invitation is accepted", async () => {
			let now: Instant = AFTER_CUTOFF;
			const org = await newOrganization("Europe/Berlin");
			const commands = createDepartureCommands({
				db: fixture.db,
				clock: { nowInstant: () => now },
				clockOut: createDepartureClockOut(),
			});
			const leaver = await fixture.seedEmployee({ organizationId: org.id });
			await commands.offboardNow(
				{ userId: org.owner.userId, organizationId: org.id },
				{
					employeeId: leaver.employeeId,
					requestId: randomUUID(),
					replacementEmployeeId: null,
					acknowledgeUnassignedDuties: true,
				},
			);
			now = REHIRED_AT;
			const invited = await invite({
				organizationId: org.id,
				inviterId: org.owner.userId,
				userId: leaver.userId,
				contractType: "hourly",
				hourlyRate: "25.00",
				startDate: day("2026-10-01"),
			});

			await accept({ organizationId: org.id, ...invited });

			expect((await employeeOf(org.id, leaver.userId))?.is_active).toBe(false);
			expect(
				(await termsOf(leaver.employeeId)).filter((row) => row.valid_from >= day("2026-10-01")),
			).toEqual([]);
		});

		/** An employee whose employment ended, and the rehire of them as hourly. */
		async function leaverToRehire() {
			let now: Instant = AFTER_CUTOFF;
			const org = await newOrganization("Europe/Berlin");
			const actor = { userId: org.owner.userId, organizationId: org.id };
			const commands = createDepartureCommands({
				db: fixture.db,
				clock: { nowInstant: () => now },
				clockOut: createDepartureClockOut(),
			});
			const target = await fixture.seedEmployee({ organizationId: org.id });
			await commands.offboardNow(actor, {
				employeeId: target.employeeId,
				requestId: randomUUID(),
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			});
			const policy = await one<{ id: string }>(
				`insert into work_policy (organization_id, name, created_by, updated_at)
				 values ($1, 'Rehire policy', $2, now()) returning id`,
				[org.id, org.owner.userId],
			);
			now = REHIRED_AT;
			const rehire = () =>
				commands.rehireEmployee(actor, {
					employeeId: target.employeeId,
					requestId: randomUUID(),
					previousEmploymentPeriodId: target.employmentPeriodId,
					role: "employee",
					teamId: null,
					primaryManagerId: null,
					workPolicyId: policy.id,
					weeklyContractMinutes: 2400,
					contractType: "hourly",
					workModel: "onsite",
					hourlyRate: 25,
					currency: "EUR",
					probationStartsOn: null,
					probationEndsOn: null,
					changeReason: "Returning",
				});
			return { org, target, rehire };
		}

		it("rehires nobody when the terms write fails", async () => {
			const { org, target, rehire } = await leaverToRehire();
			termsWrite.fail = true;

			await expect(rehire()).rejects.toThrow("terms write failed");

			expect(
				await one<{ count: number }>(
					`select count(*)::int as count from employee_employment_period
					 where employee_id = $1 and status = 'open'`,
					[target.employeeId],
				),
			).toEqual({ count: 0 });
			expect((await employeeOf(org.id, target.userId))?.is_active).toBe(false);
		});

		it("pays a rehired hourly employee from the rehire", async () => {
			const { org, target, rehire } = await leaverToRehire();

			const rehired = await rehire();

			// Rehire terms start at the rehire instant (#1162 keeps it an instant).
			expect(
				(await termsOf(target.employeeId)).filter(
					(row) => row.employment_period_id === rehired.employmentPeriodId,
				),
			).toMatchObject([
				{
					valid_from: new Date(REHIRED_AT.epochMilliseconds),
					contract_type: "hourly",
					hourly_rate: "25.00",
					review_state: "confirmed",
				},
			]);
			await work({
				organizationId: org.id,
				employeeId: target.employeeId,
				userId: target.userId,
				start: "2026-10-05T10:00:00Z",
				end: "2026-10-05T12:00:00Z",
				minutes: 120,
			});
			const result = await report({
				organizationId: org.id,
				employeeId: target.employeeId,
				startDate: "2026-10-01",
				endDate: "2026-10-31",
				timezone: "Europe/Berlin",
			});
			expect(result.hourlyEarnings).toMatchObject({
				totalHours: 2,
				totalEarnings: 50,
				currency: "EUR",
			});
		});
	});
});
