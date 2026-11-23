/**
 * #1992: who may read § 12 TzBfG on-call status and acknowledge short notice, and what each
 * audience sees. Real PostgreSQL; only the session provider is stubbed.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localInstant, onCallFixture } from "@/lib/statutory/on-call/testing/on-call-fixture";
import { integrationAdminPool } from "@/test/integration-database";
import type { StubCaller } from "@/test/organization-action";
import { statutoryFixture } from "@/test/statutory-fixtures";

const harness = vi.hoisted(() => ({ caller: null as StubCaller | null }));

vi.mock("@/lib/effect/runtime", async () => {
	const { db } = await import("@/db");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		organizationActionStubLayer(() => harness.caller, { db }),
	);
});

const {
	acknowledgeOnCallShortNoticeAction,
	getEmployeeOnCallStatusAction,
	getOnCallReferencePeriodAction,
	listOnCallPayrollReferenceRowsAction,
	listOnCallReviewItemsAction,
} = await import("./on-call-actions");

describe("on-call actions (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1992-actions");
	const onCall = onCallFixture(admin, fx);

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	async function scenario() {
		const org = await onCall.organization("a");
		const owner = await fx.user("owner");
		await fx.membership(org, owner, "owner");
		const worker = await fx.employee(org, "worker");
		await fx.membership(org, worker, "member");
		await onCall.onCallTerms(org, worker, { kind: "unspecified" });
		const manager = await fx.employee(org, "manager", { role: "manager" });
		await fx.membership(org, manager, "member");
		const stranger = await fx.employee(org, "stranger", { role: "manager" });
		await fx.membership(org, stranger, "member");
		await admin.query(
			`INSERT INTO employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 VALUES ($1, $2, true, $3)`,
			[worker.employeeId, manager.employeeId, owner.userId],
		);
		// Real dates: these actions judge the window around today.
		const now = Temporal.Now.instant();
		const today = now.toZonedDateTimeISO(org.timezone).toPlainDate();
		const shiftId = await onCall.shift(org, {
			employeeId: worker.employeeId,
			date: today.add({ days: 2 }).toString(),
			startTime: "09:00",
			endTime: "13:00",
			publishedAt: localInstant(today.toString(), "00:00", org.timezone),
		});
		await onCall.absence(org, worker, {
			type: "sick",
			startDate: today.subtract({ days: 1 }).toString(),
			endDate: today.subtract({ days: 1 }).toString(),
		});
		const as = (who: { userId: string }, membershipRole: string, employee: StubCaller["employee"]) => {
			harness.caller = {
				userId: who.userId,
				activeOrganizationId: org.id,
				membershipRole,
				employee,
			};
		};
		return { org, owner, worker, manager, stranger, shiftId, today, as };
	}

	it("lets an org admin list, acknowledge and see the documented reason", async () => {
		const { owner, worker, shiftId, as } = await scenario();
		as(owner, "owner", null);

		const listed = await listOnCallReviewItemsAction({});
		expect(listed.success).toBe(true);
		const notice = listed.success
			? listed.data.find((item) => item.finding.kind === "on_call_short_notice")
			: undefined;
		expect(notice).toMatchObject({
			employeeId: worker.employeeId,
			employeeName: "worker Test",
			finding: { subjectKey: `shift:${shiftId}`, acknowledgement: { status: "none" } },
		});

		const acknowledged = await acknowledgeOnCallShortNoticeAction({
			shiftId,
			reason: "Worker asked for the extra call",
		});
		expect(acknowledged.success).toBe(true);
		const after = await listOnCallReviewItemsAction({});
		expect(
			after.success
				? after.data.find((item) => item.finding.kind === "on_call_short_notice")?.finding
						.acknowledgement
				: null,
		).toMatchObject({ status: "current", reason: "Worker asked for the extra call" });
	});

	it("refuses review listing and acknowledgement below org admin", async () => {
		const { manager, shiftId, as } = await scenario();
		as(manager, "member", { id: manager.employeeId, role: "manager", former: false });

		expect(await listOnCallReviewItemsAction({})).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await acknowledgeOnCallShortNoticeAction({ shiftId, reason: "x" })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await listOnCallPayrollReferenceRowsAction({
				startDate: "2026-01-01",
				endDate: "2026-01-31",
				method: "three_months",
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("shows a scoped manager and the employee the wage-free status, and nobody else", async () => {
		const { owner, worker, manager, stranger, today, as } = await scenario();

		as(manager, "member", { id: manager.employeeId, role: "manager", former: false });
		const managerView = await getEmployeeOnCallStatusAction({ employeeId: worker.employeeId });
		expect(managerView.success).toBe(true);
		if (!managerView.success) return;
		expect(managerView.data).toMatchObject({
			audience: "restricted",
			hasOnCallTerms: true,
			terms: { hoursKind: "unspecified", weeklyMinutes: null, dailyMinutes: null },
		});
		const restrictedNotice = managerView.data.findings.find(
			(f) => f.kind === "on_call_short_notice",
		);
		expect(restrictedNotice).toMatchObject({ adminDetail: null, inputFingerprint: null });
		expect(JSON.stringify(managerView.data)).not.toMatch(/hourly|wage|rate|cents/i);
		expect(managerView.data.referenceEvents.map((e) => [e.kind, e.eventDate])).toEqual([
			["sick_leave", today.subtract({ days: 1 }).toString()],
		]);

		as(worker, "member", { id: worker.employeeId, role: "employee", former: false });
		const selfView = await getEmployeeOnCallStatusAction({ employeeId: worker.employeeId });
		expect(selfView).toMatchObject({ success: true, data: { audience: "restricted" } });
		const selfReference = await getOnCallReferencePeriodAction({
			employeeId: worker.employeeId,
			eventDate: today.toString(),
			method: "thirteen_weeks",
		});
		expect(selfReference).toMatchObject({ success: true, data: { method: "thirteen_weeks" } });

		as(stranger, "member", { id: stranger.employeeId, role: "manager", former: false });
		expect(await getEmployeeOnCallStatusAction({ employeeId: worker.employeeId })).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});

		as(owner, "owner", null);
		const adminView = await getEmployeeOnCallStatusAction({ employeeId: worker.employeeId });
		expect(adminView).toMatchObject({ success: true, data: { audience: "full" } });
		const adminNotice = adminView.success
			? adminView.data.findings.find((f) => f.kind === "on_call_short_notice")
			: undefined;
		expect(adminNotice?.inputFingerprint).toMatch(/^v1:/);
	});

	it("lists payroll reference rows for the period's sick leave", async () => {
		const { owner, worker, today, as } = await scenario();
		as(owner, "owner", null);

		const rows = await listOnCallPayrollReferenceRowsAction({
			startDate: today.subtract({ days: 3 }).toString(),
			endDate: today.toString(),
			method: "three_months",
		});

		expect(rows).toMatchObject({
			success: true,
			data: [
				{
					employeeId: worker.employeeId,
					employeeName: "worker Test",
					kind: "sick_leave",
					eventDate: today.subtract({ days: 1 }).toString(),
				},
			],
		});
	});
});
