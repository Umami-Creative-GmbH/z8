/**
 * #1989: Minijob monitor actions against real PostgreSQL. Org admins get the EUR breakdown, edit
 * external offsets and acknowledge exceedances; scoped managers get wage-free tiers of the
 * employees they manage and nothing else.
 */
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { minijobFixture } from "@/lib/statutory/minijob/minijob-database.test.fixture";
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

const employeeActions = await import("./minijob-actions");
const reviewActions = await import("../contracts/minijob-review-actions");

describe("Minijob monitor actions (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1989-actions");
	const mj = minijobFixture(admin, fx);
	const currentMonth = Temporal.Now.plainDateISO("Europe/Berlin").toString().slice(0, 7);

	beforeEach(async () => {
		mj.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	async function setup() {
		const org = await fx.organization("a");
		const owner = await fx.user("owner");
		await fx.membership(org, owner, "owner");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		const manager = await fx.employee(org, "manager", { role: "manager" });
		await fx.membership(org, manager, "member");
		await admin.query(
			`INSERT INTO employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 VALUES ($1, $2, true, $3)`,
			[worker.employeeId, manager.employeeId, owner.userId],
		);
		const outsider = await fx.employee(org, "outsider", { role: "manager" });
		await fx.membership(org, outsider, "member");
		// 12.34 € an hour; 57 h this month earn 703.38 €, above every cap since 2026.
		await mj.terms(worker, owner, { from: "2025-01-01", hourlyRate: 12.34 });
		await mj.monthWork(org, worker, currentMonth, 57 * 60);

		const asOwner: StubCaller = {
			userId: owner.userId,
			activeOrganizationId: org.id,
			membershipRole: "owner",
			employee: null,
		};
		const asManager: StubCaller = {
			userId: manager.userId,
			activeOrganizationId: org.id,
			membershipRole: "member",
			employee: { id: manager.employeeId, role: "manager", former: false },
		};
		const asOutsider: StubCaller = {
			userId: outsider.userId,
			activeOrganizationId: org.id,
			membershipRole: "member",
			employee: { id: outsider.employeeId, role: "manager", former: false },
		};
		return { org, owner, worker, asOwner, asManager, asOutsider };
	}

	it("shows org admins the EUR breakdown of each month", async () => {
		const { worker, asOwner } = await setup();
		harness.caller = asOwner;

		const result = await employeeActions.getEmployeeMinijobMonitorAction({
			employeeId: worker.employeeId,
		});

		expect(result).toMatchObject({
			success: true,
			data: { audience: "full", applies: true, currentMonth, externalOffsets: [] },
		});
		const month = result.success ? result.data.months.find((m) => m.month === currentMonth) : null;
		expect(month).toMatchObject({
			tier: "exceeded",
			earnedCents: 70_338,
			totalCents: 70_338,
			exceedance: { status: "unacknowledged", acknowledgeable: true },
		});
	});

	it("gives the employee's scoped manager wage-free tiers only", async () => {
		const { worker, asManager } = await setup();
		harness.caller = asManager;

		const result = await employeeActions.getEmployeeMinijobMonitorAction({
			employeeId: worker.employeeId,
		});

		if (!result.success) throw new Error(result.error);
		expect(result.data.audience).toBe("restricted");
		expect(result.data).not.toHaveProperty("externalOffsets");
		expect(result.data.months.find((m) => m.month === currentMonth)).toEqual({
			month: currentMonth,
			isMinijob: true,
			tier: "exceeded",
			rollingTier: expect.any(String),
		});
		for (const month of result.data.months) {
			expect(Object.keys(month).sort()).toEqual(["isMinijob", "month", "rollingTier", "tier"]);
		}
	});

	it("refuses managers who do not manage the employee", async () => {
		const { worker, asOutsider } = await setup();
		harness.caller = asOutsider;

		expect(
			await employeeActions.getEmployeeMinijobMonitorAction({ employeeId: worker.employeeId }),
		).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("lets only org admins record and void external Minijob earnings", async () => {
		const { worker, asOwner, asManager } = await setup();
		const offset = {
			employeeId: worker.employeeId,
			fromMonth: currentMonth,
			lastMonth: null,
			amountCents: 15_000,
			sourceEmployer: "Bäckerei Nord",
			note: "Payslip of the other Minijob",
		};

		harness.caller = asManager;
		expect(await employeeActions.recordMinijobExternalOffsetAction(offset)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});

		harness.caller = asOwner;
		const recorded = await employeeActions.recordMinijobExternalOffsetAction(offset);
		if (!recorded.success) throw new Error(recorded.error);
		const withOffset = await employeeActions.getEmployeeMinijobMonitorAction({
			employeeId: worker.employeeId,
		});
		if (!withOffset.success || withOffset.data.audience !== "full") throw new Error("no view");
		expect(withOffset.data.externalOffsets).toEqual([
			expect.objectContaining({
				id: recorded.data.id,
				fromMonth: currentMonth,
				lastMonth: null,
				amountCents: 15_000,
				sourceEmployer: "Bäckerei Nord",
			}),
		]);
		expect(withOffset.data.months.find((m) => m.month === currentMonth)?.externalCents).toBe(
			15_000,
		);

		harness.caller = asManager;
		expect(
			await employeeActions.voidMinijobExternalOffsetAction({
				employeeId: worker.employeeId,
				offsetId: recorded.data.id,
				reason: "Wrong employee",
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });

		harness.caller = asOwner;
		expect(
			await employeeActions.voidMinijobExternalOffsetAction({
				employeeId: worker.employeeId,
				offsetId: recorded.data.id,
				reason: "Wrong employee",
			}),
		).toMatchObject({ success: true });
		const afterVoid = await employeeActions.getEmployeeMinijobMonitorAction({
			employeeId: worker.employeeId,
		});
		expect(afterVoid).toMatchObject({ success: true, data: { externalOffsets: [] } });
	});

	it("lists open exceedances in Reviews & Conflicts until an org admin acknowledges them", async () => {
		const { org, worker, asOwner, asManager } = await setup();

		harness.caller = asManager;
		expect(
			await reviewActions.listMinijobExceedanceReviewsAction({ includeAcknowledged: false }),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(
			await reviewActions.acknowledgeMinijobExceedanceAction({
				employeeId: worker.employeeId,
				month: currentMonth,
				reason: "Sick cover",
				legalNote: null,
				expectedFingerprint: "guessed",
				expectedTotalCents: 0,
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });

		harness.caller = asOwner;
		const open = await reviewActions.listMinijobExceedanceReviewsAction({
			includeAcknowledged: false,
		});
		expect(open).toMatchObject({
			success: true,
			data: [
				{
					employeeId: worker.employeeId,
					employeeName: "worker",
					month: currentMonth,
					severity: "critical",
					status: "unacknowledged",
					acknowledgeable: true,
					totalCents: 70_338,
					acknowledgement: { status: "none" },
				},
			],
		});

		if (!open.success) throw new Error(open.error);
		const [shown] = open.data;
		expect(shown.inputFingerprint).toEqual(expect.any(String));
		const acknowledgement = {
			employeeId: worker.employeeId,
			month: currentMonth,
			reason: "Covered a colleague's unplanned sick leave",
			legalNote: "§ 8 Abs. 1b SGB IV",
		};

		// Figures the admin never saw cannot be documented.
		await mj.work(org, worker, `${currentMonth}-01`, 30, "06:00");
		expect(
			await reviewActions.acknowledgeMinijobExceedanceAction({
				...acknowledgement,
				expectedFingerprint: shown.inputFingerprint,
				expectedTotalCents: shown.totalCents,
			}),
		).toMatchObject({ success: false, refusal: "minijob_exceedance_changed" });

		const reloaded = await reviewActions.listMinijobExceedanceReviewsAction({
			includeAcknowledged: false,
		});
		if (!reloaded.success) throw new Error(reloaded.error);
		expect(
			await reviewActions.acknowledgeMinijobExceedanceAction({
				...acknowledgement,
				expectedFingerprint: reloaded.data[0].inputFingerprint,
				expectedTotalCents: reloaded.data[0].totalCents,
			}),
		).toMatchObject({ success: true });

		expect(
			await reviewActions.listMinijobExceedanceReviewsAction({ includeAcknowledged: false }),
		).toMatchObject({ success: true, data: [] });
		expect(
			await reviewActions.listMinijobExceedanceReviewsAction({ includeAcknowledged: true }),
		).toMatchObject({
			success: true,
			data: [
				{
					month: currentMonth,
					severity: "info",
					status: "acknowledged",
					acknowledgement: {
						status: "current",
						acknowledgedBy: asOwner.userId,
						reason: "Covered a colleague's unplanned sick leave",
					},
				},
			],
		});
	});
});
