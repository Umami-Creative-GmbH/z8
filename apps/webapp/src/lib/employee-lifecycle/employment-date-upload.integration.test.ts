import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(new Date().toISOString()) },
	};
});
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `bulk-employment-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/email/email-service", async (original) =>
	(await import("@/test/integration-harness")).emailService(original),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
const actions = await import(
	"@/app/[locale]/(app)/settings/employees/employment-date-upload-actions"
);
const { loadVacationBalances } = await import("@/lib/absences/vacation-balance-store");
const { getEmployeeTrackingDateAction } = await import(
	"@/app/[locale]/(app)/settings/employees/employee-tracking-date-actions"
);
const balances = await import("@/lib/work-balance/service");
describe("reviewed bulk employment corrections through public upload actions", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let secondId: string;
	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-06-01T10:00:00Z"));
		fixture = await createLifecycleDatabaseFixture();
		harness.userId = fixture.ownerUserId;
		harness.organizationId = fixture.organizationId;
		secondId = (await fixture.seedEmployee({ startDate: new Date("2026-05-21T00:00:00Z") }))
			.employeeId;
		await fixture.pool.query(`update organization set timezone='Europe/Berlin' where id=$1`, [
			fixture.organizationId,
		]);
		await fixture.pool.query(
			`update employee set start_date='2026-05-21',employee_number=case when id=$1 then 'QA001' else 'QA002' end where id=any($2::uuid[])`,
			[fixture.employeeId, [fixture.employeeId, secondId]],
		);
		await fixture.pool.query(
			`update employee_employment_period set started_at='2026-05-20T22:00:00Z',start_provenance='legacy' where employee_id=any($1::uuid[])`,
			[[fixture.employeeId, secondId]],
		);
		await fixture.pool.query(
			`insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at) values ($1,'2026-05-21',now())`,
			[fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into vacation_allowance (organization_id,name,start_date,is_company_default,default_annual_days,accrual_type,statutory_minimum_days,created_by,updated_at) values ($1,'Annual','2020-01-01',true,30,'annual',20,$2,now())`,
			[fixture.organizationId, fixture.ownerUserId],
		);

		const policy = randomUUID(),
			schedule = randomUUID();
		await fixture.pool.query(
			`insert into work_policy (id,organization_id,name,schedule_enabled,regulation_enabled,created_by,updated_at) values ($1,$2,'Monday hour',true,false,$3,now())`,
			[policy, fixture.organizationId, fixture.ownerUserId],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule (id,policy_id,schedule_cycle,schedule_type,working_days_preset,updated_at) values ($1,$2,'weekly','detailed','custom',now())`,
			[schedule, policy],
		);
		await fixture.pool.query(
			`insert into work_policy_schedule_day (schedule_id,day_of_week,hours_per_day,is_work_day) values ($1,'monday','1.00',true)`,
			[schedule],
		);
		for (const employeeId of [fixture.employeeId, secondId])
			await fixture.pool.query(
				`insert into work_policy_assignment (policy_id,organization_id,assignment_type,employee_id,priority,created_by,updated_at) values ($1,$2,'employee',$3,2,$4,now())`,
				[policy, fixture.organizationId, employeeId, fixture.ownerUserId],
			);
	});
	afterEach(async () => {
		if (fixture)
			await fixture.pool.query(
				`delete from vacation_adjustment where employee_id in (select id from employee where organization_id=$1)`,
				[fixture.organizationId],
			);
		await fixture?.close();
		vi.useRealTimers();
	});
	const csv = () =>
		"employee_number,employment_start_date,reason\nQA001,2019-01-01,Signed employment record\nQA002,2021-02-01,Signed joining record\n";
	async function vacation() {
		return (
			await loadVacationBalances(fixture.db, {
				organizationId: fixture.organizationId,
				employeeIds: [fixture.employeeId, secondId],
				year: 2026,
				timezone: "Europe/Berlin",
			})
		).balances;
	}
	it("reviews two supplied historical joining dates then restores their allowances together without pre-rollout required time", async () => {
		expect([...(await vacation()).values()].map((balance) => balance.allowanceDays)).toEqual([
			20, 20,
		]);
		const preview = await actions.previewEmploymentDateUploadAction({ csv: csv() });
		expect(preview).toMatchObject({
			success: true,
			data: {
				status: "ready",
				rows: [
					{
						row: 2,
						employee: { id: fixture.employeeId },
						employmentStartDate: "2019-01-01",
						impact: {
							previousEmploymentStartDate: "2026-05-21",
							employees: [{ proposedBoundary: "2026-05-21" }],
							vacation: expect.arrayContaining([
								expect.objectContaining({
									year: 2026,
									before: expect.objectContaining({ allowanceDays: 20 }),
									after: expect.objectContaining({ allowanceDays: 30 }),
								}),
							]),
						},
					},
					{ row: 3, employee: { id: secondId }, employmentStartDate: "2021-02-01" },
				],
			},
		});
		expect([...(await vacation()).values()].map((balance) => balance.allowanceDays)).toEqual([
			20, 20,
		]);
		if (!preview.success || preview.data.status !== "ready")
			throw new Error("Expected reviewable upload");
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: preview.data.fingerprint,
			}),
		).toMatchObject({ success: true, data: { status: "committed", corrected: 2 } });
		expect([...(await vacation()).values()].map((balance) => balance.allowanceDays)).toEqual([
			30, 30,
		]);
		for (const employeeId of [fixture.employeeId, secondId])
			expect(await getEmployeeTrackingDateAction(employeeId)).toMatchObject({
				success: true,
				data: {
					organizationTrackingStartDate: "2026-05-21",
					effectiveTrackingStartDate: "2026-05-21",
				},
			});
		expect(await getEmployeeTrackingDateAction(fixture.employeeId)).toMatchObject({
			success: true,
			data: { employmentStartDate: "2019-01-01" },
		});
	});
	async function previewUpload(text = csv()) {
		const result = await actions.previewEmploymentDateUploadAction({ csv: text });
		if (!result.success) throw new Error(result.error);
		return result.data;
	}
	async function readyUpload(text = csv()) {
		const review = await previewUpload(text);
		if (review.status !== "ready") throw new Error("Expected valid upload");
		return review;
	}
	async function assertOriginalDates() {
		for (const employeeId of [fixture.employeeId, secondId])
			expect(await getEmployeeTrackingDateAction(employeeId)).toMatchObject({
				success: true,
				data: { employmentStartDate: "2026-05-21" },
			});
	}
	it("does not accumulate historical required time and keeps genuine later joiners on their actual employment floor", async () => {
		const text =
			"employee_number,employment_start_date,reason\nQA001,2019-01-01,Signed original record\nQA002,2026-05-26,Genuine joining date\n";
		const review = await readyUpload(text);
		expect(review.rows[0].impact?.employees[0]).toMatchObject({
			proposedBoundary: "2026-05-21",
			after: { requiredMinutes: 60 },
		});
		expect(review.rows[1].impact?.employees[0]).toMatchObject({
			proposedBoundary: "2026-05-26",
			after: { requiredMinutes: 0 },
		});
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: text,
				fingerprint: review.fingerprint,
			}),
		).toMatchObject({ success: true, data: { status: "committed" } });
		expect(
			await balances.getEmployeeWorkBalance({
				organizationId: fixture.organizationId,
				employeeId: fixture.employeeId,
			}),
		).toMatchObject({ computedFromDate: "2026-05-21", requiredMinutes: 60 });
		expect(
			await balances.getEmployeeWorkBalance({
				organizationId: fixture.organizationId,
				employeeId: secondId,
			}),
		).toMatchObject({ computedFromDate: "2026-05-26", requiredMinutes: 0 });
	});
	it("shows missing, invalid, duplicate and unknown identifiers as row errors and writes none of the valid rows", async () => {
		const text =
			"employee_number,employment_start_date,reason\nQA001,2019-01-01,Signed record\nQA002,2026-02-31,Invalid calendar date\n,2021-01-01,Missing personnel number\nUNKNOWN,2021-01-01,Unknown personnel number\n";
		const preview = await previewUpload(text);
		expect(preview).toMatchObject({
			status: "has_errors",
			rows: [
				{ errors: [] },
				{
					row: 3,
					errors: expect.arrayContaining([expect.objectContaining({ code: "invalid_date" })]),
				},
				{
					row: 4,
					errors: expect.arrayContaining([
						expect.objectContaining({ code: "employee_number_required" }),
					]),
				},
				{
					row: 5,
					errors: expect.arrayContaining([expect.objectContaining({ code: "unknown_employee" })]),
				},
			],
		});
		const prior = await readyUpload();
		expect(
			await actions.commitEmploymentDateUploadAction({ csv: text, fingerprint: prior.fingerprint }),
		).toMatchObject({ success: true, data: { status: "has_errors" } });
		await assertOriginalDates();
		const duplicates = await previewUpload(
			"employee_number;employment_start_date;reason\nQA001;2019-01-01;Original record\n qa001 ;2021-01-01;Duplicate target\n",
		);
		expect(duplicates).toMatchObject({
			status: "has_errors",
			rows: [
				{
					errors: expect.arrayContaining([expect.objectContaining({ code: "duplicate_employee" })]),
				},
				{
					errors: expect.arrayContaining([expect.objectContaining({ code: "duplicate_employee" })]),
				},
			],
		});
	});
	it("matches only current-organization personnel numbers and refuses ambiguous identifiers conservatively", async () => {
		const foreign = await fixture.seedEmployee({
			organizationId: await fixture.createOrganization(),
		});
		await fixture.pool.query(`update employee set employee_number='FOREIGN' where id=$1`, [
			foreign.employeeId,
		]);
		expect(
			await previewUpload(
				"employee_number,employment_start_date,reason\nFOREIGN,2019-01-01,Foreign employee\n",
			),
		).toMatchObject({
			status: "has_errors",
			rows: [
				{
					employee: null,
					errors: expect.arrayContaining([expect.objectContaining({ code: "unknown_employee" })]),
				},
			],
		});
		// PostgreSQL lower() and the existing JS personnel key can differ for final sigma.
		await fixture.pool.query(
			`update employee set employee_number=case when id=$1 then 'ΟΣ' else 'Ος' end where id=any($2::uuid[])`,
			[fixture.employeeId, [fixture.employeeId, secondId]],
		);
		expect(
			await previewUpload(
				"employee_number,employment_start_date,reason\nΟΣ,2019-01-01,Ambiguous shared personnel key\n",
			),
		).toMatchObject({
			status: "has_errors",
			rows: [
				{
					employee: null,
					errors: expect.arrayContaining([expect.objectContaining({ code: "ambiguous_employee" })]),
				},
			],
		});
		await assertOriginalDates();
	});
	it("refuses lifecycle-invalid original dates for the whole batch without inventing an employment period", async () => {
		await fixture.pool.query(
			`update employee set is_active=false,end_date='2026-05-24' where id=$1`,
			[secondId],
		);
		await fixture.pool.query(
			`update employee_employment_period set status='closed',ended_at='2026-05-24T22:00:00Z' where employee_id=$1`,
			[secondId],
		);
		const text =
			"employee_number,employment_start_date,reason\nQA001,2019-01-01,Valid first row\nQA002,2026-05-25,After original departure\n";
		expect(await previewUpload(text)).toMatchObject({
			status: "has_errors",
			rows: [
				{ errors: [] },
				{
					employee: { id: secondId, isActive: false },
					errors: expect.arrayContaining([expect.objectContaining({ code: "after_departure" })]),
				},
			],
		});
		expect(
			await actions.commitEmploymentDateUploadAction({ csv: text, fingerprint: "a".repeat(64) }),
		).toMatchObject({ success: true, data: { status: "has_errors" } });
		await assertOriginalDates();
	});
	it("rejects changed uploads, intervening source changes and replayed commits", async () => {
		const first = await readyUpload();
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv().replace("2019-01-01", "2018-01-01"),
				fingerprint: first.fingerprint,
			}),
		).toMatchObject({ success: false, code: "stale_preview" });
		await assertOriginalDates();
		await fixture.pool.query(
			`update employee set position='Intervening personnel change' where id=$1`,
			[secondId],
		);
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: first.fingerprint,
			}),
		).toMatchObject({ success: false, code: "stale_preview" });
		await assertOriginalDates();
		const current = await readyUpload();
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: current.fingerprint,
			}),
		).toMatchObject({ success: true, data: { status: "committed" } });
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: current.fingerprint,
			}),
		).toMatchObject({ success: false, code: "stale_preview" });
	});
	it("refuses the entire batch while one affected month is closed, then permits a fresh review after explicit reopening", async () => {
		const months = await import("@/app/[locale]/(app)/settings/closed-months/actions");
		const beforeClose = await readyUpload();
		expect(
			await months.closeMonthAction({ month: "2026-05", scope: { kind: "organization" } }),
		).toMatchObject({ success: true });
		const review = await previewUpload();
		expect(review).toMatchObject({
			status: "has_errors",
			rows: [
				{ errors: expect.arrayContaining([expect.objectContaining({ code: "month_closed" })]) },
				{ errors: expect.arrayContaining([expect.objectContaining({ code: "month_closed" })]) },
			],
		});
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: beforeClose.fingerprint,
			}),
		).toMatchObject({ success: true, data: { status: "has_errors" } });
		await assertOriginalDates();
		expect([...(await vacation()).values()].map((balance) => balance.allowanceDays)).toEqual([
			20, 20,
		]);
		expect(
			await months.reopenMonthAction({
				month: "2026-05",
				scope: { kind: "all" },
				reason: "Review supplied actual joining dates",
			}),
		).toMatchObject({ success: true });
		const reopened = await readyUpload();
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: reopened.fingerprint,
			}),
		).toMatchObject({ success: true, data: { status: "committed", corrected: 2 } });
	});
	it("rolls every employee and vacation change back when an individual correction fails during application", async () => {
		const review = await readyUpload();
		const lastId = [fixture.employeeId, secondId].sort().at(-1)!;
		await fixture.pool.query(
			`create function t1243_refuse_audit() returns trigger language plpgsql as $$ begin if NEW.action='employee.employment_start_corrected' and NEW.entity_id='${lastId}' then raise exception 'injected second correction audit refusal'; end if; return NEW; end $$`,
		);
		await fixture.pool.query(
			`create trigger t1243_refuse_audit before insert on audit_log for each row execute function t1243_refuse_audit()`,
		);
		try {
			expect(
				await actions.commitEmploymentDateUploadAction({
					csv: csv(),
					fingerprint: review.fingerprint,
				}),
			).toMatchObject({ success: false, code: "failed" });
			await assertOriginalDates();
			expect([...(await vacation()).values()].map((balance) => balance.allowanceDays)).toEqual([
				20, 20,
			]);
		} finally {
			await fixture.pool.query(`drop trigger t1243_refuse_audit on audit_log`);
			await fixture.pool.query(`drop function t1243_refuse_audit()`);
		}
	});
	it("rechecks admin authority and organization scope rather than accepting submitted matches", async () => {
		const review = await readyUpload();
		await fixture.seedEmployee({ role: "owner" });
		await fixture.pool.query(
			`update member set role='member' where user_id=$1 and organization_id=$2`,
			[fixture.ownerUserId, fixture.organizationId],
		);
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: review.fingerprint,
			}),
		).toMatchObject({ success: false, code: "not_permitted" });
		const member = await fixture.seedEmployee();
		harness.userId = member.userId;
		expect(await actions.previewEmploymentDateUploadAction({ csv: csv() })).toMatchObject({
			success: false,
			code: "not_permitted",
		});
		harness.userId = fixture.ownerUserId;
		harness.organizationId = await fixture.createOrganization();
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: review.fingerprint,
			}),
		).toMatchObject({ success: false, code: "not_permitted" });
	});
	it("keeps employee exceptions, checkpoints and unrelated vacation choices when applying every reviewed row", async () => {
		const adjustment = await import("@/app/[locale]/(app)/settings/employees/work-balance-actions");
		await fixture.pool.query(
			`insert into employee_tracking_settings(organization_id,employee_id,tracking_start_date) values ($1,$2,'2026-05-26')`,
			[fixture.organizationId, fixture.employeeId],
		);
		await fixture.pool.query(
			`update vacation_allowance set allow_carryover=true where organization_id=$1`,
			[fixture.organizationId],
		);
		await fixture.pool.query(
			`insert into employee_vacation_allowance(employee_id,year,custom_annual_days,custom_carryover_days,updated_at) values ($1,2026,36,4,now())`,
			[fixture.employeeId],
		);
		expect(
			await adjustment.setOpeningBalanceAction({
				employeeId: fixture.employeeId,
				day: "2026-05-20",
				hours: 2,
				minutes: 0,
				negative: false,
				reason: "Prior system checkpoint",
			}),
		).toMatchObject({ success: true });
		const review = await readyUpload();
		expect(review.rows[0].impact?.employees[0]).toMatchObject({
			proposedBoundary: "2026-05-26",
			openingBalance: { day: "2026-05-20", minutes: 120 },
		});
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: review.fingerprint,
			}),
		).toMatchObject({ success: true, data: { status: "committed" } });
		expect(await getEmployeeTrackingDateAction(fixture.employeeId)).toMatchObject({
			success: true,
			data: { employeeTrackingStartDate: "2026-05-26", effectiveTrackingStartDate: "2026-05-26" },
		});
		expect((await vacation()).get(fixture.employeeId)).toMatchObject({
			allowanceDays: 36,
			carryoverDays: 4,
		});
		expect(
			await adjustment.getEmployeeWorkBalanceSectionAction({ employeeId: fixture.employeeId }),
		).toMatchObject({
			success: true,
			data: {
				balance: { balanceMinutes: 120 },
				adjustments: expect.arrayContaining([
					expect.objectContaining({ kind: "opening_balance", day: "2026-05-20", minutes: 120 }),
				]),
			},
		});
	});
	it("accepts the established spreadsheet format and refuses malformed or incomplete files", async () => {
		const spreadsheet =
			"\uFEFFsep=;\r\n employee number ; EMPLOYMENT-START-DATE ; reason\r\n qa001 ;01.01.2019;Signed record\r\nQA002;01.02.2021;Signed record\r\n";
		expect(await previewUpload(spreadsheet)).toMatchObject({
			status: "ready",
			rows: [
				{ employee: { id: fixture.employeeId }, employmentStartDate: "2019-01-01" },
				{ employee: { id: secondId }, employmentStartDate: "2021-02-01" },
			],
		});
		for (const [text, code] of [
			["", "no_rows"],
			["employee_number,reason\nQA001,Signed record\n", "missing_columns"],
			[
				'employee_number,employment_start_date,reason\nQA001,2019-01-01,"Unclosed quote',
				"malformed_csv",
			],
		])
			expect(await previewUpload(text)).toMatchObject({ status: "invalid_file", code });
		await assertOriginalDates();
	});
	it("consumes even an unchanged-date review so the same submitted batch cannot be applied twice", async () => {
		const initial = await readyUpload();
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: initial.fingerprint,
			}),
		).toMatchObject({ success: true, data: { status: "committed" } });
		const unchanged = await readyUpload();
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: unchanged.fingerprint,
			}),
		).toMatchObject({ success: true, data: { status: "committed" } });
		expect(
			await actions.commitEmploymentDateUploadAction({
				csv: csv(),
				fingerprint: unchanged.fingerprint,
			}),
		).toMatchObject({ success: false, code: "stale_preview" });
	});
});
