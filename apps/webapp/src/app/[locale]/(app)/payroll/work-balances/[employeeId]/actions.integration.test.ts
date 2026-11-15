import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";

const caller = vi.hoisted(() => ({ userId: "", organizationId: "" }));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: caller.userId, role: "user" },
				session: {
					id: "r044-public-session",
					userId: caller.userId,
					activeOrganizationId: caller.organizationId,
				},
			}),
		},
	},
}));

const actions = await import("@/app/[locale]/(app)/settings/employees/work-balance-actions");
const { getPayrollEmployeeBalanceAction: read } = await import("./actions");
const today = plainDateAt(systemClock.nowInstant(), "UTC");
let fixture: LifecycleDatabaseFixture,
	holder: SeededEmployee,
	target: SeededEmployee,
	uncovered: SeededEmployee,
	foreign: SeededEmployee,
	grant: string;
beforeAll(async () => {
	fixture = await createLifecycleDatabaseFixture();
	await fixture.pool.query("update organization set timezone='UTC' where id=$1", [
		fixture.organizationId,
	]);
	holder = await fixture.seedEmployee();
	target = await fixture.seedEmployee({
		isActive: false,
		startDate: new Date(`${today.subtract({ days: 5 }).toString()}T00:00:00Z`),
	});
	uncovered = await fixture.seedEmployee();
	foreign = await fixture.seedEmployee({ organizationId: await fixture.createOrganization() });
	grant = randomUUID();
	await fixture.pool.query(
		"insert into payroll_access_grant(id,organization_id,payroll_employee_id,scope,created_by,updated_at) values($1,$2,$3,'specific',$4,now())",
		[grant, fixture.organizationId, holder.employeeId, fixture.ownerUserId],
	);
	await fixture.pool.query(
		"insert into payroll_access_employee(organization_id,grant_id,employee_id,created_by) values($1,$2,$3,$4)",
		[fixture.organizationId, grant, target.employeeId, fixture.ownerUserId],
	);
	const day = today.subtract({ days: 2 }).toString(),
		clockIn = randomUUID(),
		clockOut = randomUUID();
	for (const [id, type, stamp] of [
		[clockIn, "clock_in", `${day}T10:00:00Z`],
		[clockOut, "clock_out", `${day}T12:00:00Z`],
	])
		await fixture.pool.query(
			"insert into time_entry(id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values($1,$2,$3,$4,$5,120,'Europe/Berlin','user_setting',$7,$6)",
			[id, target.employeeId, fixture.organizationId, type, stamp, fixture.ownerUserId, id],
		);
	await withCanonicalRecords(fixture.pool, (client) =>
		client.query(
			"insert into work_period(employee_id,organization_id,clock_in_id,clock_out_id,start_time,end_time,duration_minutes,is_active,updated_at) values($1,$2,$3,$4,$5,$6,120,false,now())",
			[
				target.employeeId,
				fixture.organizationId,
				clockIn,
				clockOut,
				`${day}T10:00:00Z`,
				`${day}T12:00:00Z`,
			],
		),
	);
	caller.userId = holder.userId;
	caller.organizationId = fixture.organizationId;
}, 120000);
afterAll(async () => {
	await fixture?.close();
});

it("keeps former payroll coverage independent and refuses uncovered/foreign/self targets", async () => {
	expect(await read({ employeeId: target.employeeId })).toMatchObject({
		success: true,
		data: { canManage: true },
	});
	for (const employeeId of [uncovered.employeeId, foreign.employeeId, holder.employeeId, "invalid"])
		expect(await read({ employeeId })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
}, 120000);

it("replaces opening evidence, refuses payout bounds, cancels/readbacks and leaves original UTC work intact", async () => {
	const original = await fixture.pool.query(
		"select id,timestamp,utc_offset_minutes,timezone from time_entry where organization_id=$1 and employee_id=$2 order by id",
		[fixture.organizationId, target.employeeId],
	);
	const opening = {
		employeeId: target.employeeId,
		day: today.subtract({ days: 3 }).toString(),
		negative: false,
		hours: 10,
		minutes: 0,
		reason: "R044 original opening",
	};
	expect(await actions.setOpeningBalanceAction(opening)).toMatchObject({ success: true });
	expect(
		await actions.setOpeningBalanceAction({
			...opening,
			hours: 8,
			reason: "R044 reasoned replacement",
		}),
	).toMatchObject({ success: true });
	const replaced = await read({ employeeId: target.employeeId });
	expect(replaced).toMatchObject({
		success: true,
		data: {
			balance: { balanceMinutes: 600 },
			adjustments: expect.arrayContaining([
				expect.objectContaining({
					reason: "R044 original opening",
					cancellation: expect.objectContaining({ reason: "R044 reasoned replacement" }),
				}),
			]),
		},
	});
	const payout = {
		employeeId: target.employeeId,
		day: today.subtract({ days: 1 }).toString(),
		hours: 11,
		minutes: 0,
		reason: "R044 wages record",
	};
	expect(await actions.recordOvertimePayoutAction(payout)).toMatchObject({
		success: false,
		refusal: "exceeds_balance",
	});
	const recorded = await actions.recordOvertimePayoutAction({ ...payout, hours: 10 });
	expect(recorded.success).toBe(true);
	if (!recorded.success) throw Error("Payout refused");
	expect(await read({ employeeId: target.employeeId })).toMatchObject({
		success: true,
		data: { balance: { balanceMinutes: 0 } },
	});
	expect(
		await actions.recordOvertimePayoutAction({ ...payout, hours: 0, minutes: 1 }),
	).toMatchObject({ success: false, refusal: "exceeds_balance" });
	expect(
		await actions.setOpeningBalanceAction({ ...opening, day: today.toString() }),
	).toMatchObject({ success: false, refusal: "conflicting_payouts" });
	const cancel = {
		employeeId: target.employeeId,
		adjustmentId: recorded.data.adjustmentId,
		reason: "R044 cancellation evidence",
	};
	expect(await actions.cancelBalanceAdjustmentAction(cancel)).toMatchObject({ success: true });
	expect(await actions.cancelBalanceAdjustmentAction(cancel)).toMatchObject({
		success: false,
		refusal: "already_cancelled",
	});
	expect(await read({ employeeId: target.employeeId })).toMatchObject({
		success: true,
		data: {
			balance: { balanceMinutes: 600 },
			adjustments: expect.arrayContaining([
				expect.objectContaining({
					id: recorded.data.adjustmentId,
					cancellation: expect.objectContaining({
						reason: cancel.reason,
						cancelledBy: { userId: holder.userId, name: expect.any(String) },
					}),
				}),
			]),
		},
	});
	expect(
		(
			await fixture.pool.query(
				"select id,timestamp,utc_offset_minutes,timezone from time_entry where organization_id=$1 and employee_id=$2 order by id",
				[fixture.organizationId, target.employeeId],
			)
		).rows,
	).toEqual(original.rows);
}, 120000);

it("rechecks grant, approved membership and active organization at late submission", async () => {
	const input = {
		employeeId: target.employeeId,
		day: today.toString(),
		hours: 1,
		minutes: 0,
		reason: "Late request",
	};
	await fixture.pool.query("update payroll_access_grant set is_active=false where id=$1", [grant]);
	expect(await read({ employeeId: target.employeeId })).toMatchObject({ success: false });
	expect(await actions.recordOvertimePayoutAction(input)).toMatchObject({
		success: false,
		refusal: "not_permitted",
	});
	await fixture.pool.query("update payroll_access_grant set is_active=true where id=$1", [grant]);
	await fixture.pool.query("update member set status='pending' where id=$1", [holder.memberId]);
	expect(await actions.recordOvertimePayoutAction(input)).toMatchObject({
		success: false,
		code: "AuthorizationError",
	});
	await fixture.pool.query("update member set status='approved' where id=$1", [holder.memberId]);
	caller.organizationId = await fixture.createOrganization();
	expect(await read({ employeeId: target.employeeId })).toMatchObject({ success: false });
	expect((await actions.recordOvertimePayoutAction(input)).success).toBe(false);
	caller.organizationId = fixture.organizationId;
}, 120000);
