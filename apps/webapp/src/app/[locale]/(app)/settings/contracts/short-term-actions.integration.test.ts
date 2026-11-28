/**
 * #1990: the short-term employment actions behind Employee Detail and Reviews & Conflicts, with a
 * synthetic signed-in caller over real PostgreSQL. Org admins see earnings and prior-employer
 * entries and document Berufsmäßigkeit verifications; scoped managers see the wage-free allowance
 * of employees they manage, and nothing derived from earnings.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { shortTermFixture } from "@/lib/statutory/short-term/__tests__/short-term-fixture";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";

const caller = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	membershipRole: "owner" as string,
	employee: null as { id: string; role: "employee" | "manager" | "admin" } | null,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { db } = await import("@/db");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		organizationActionStubLayer(
			() => ({
				userId: caller.userId,
				activeOrganizationId: caller.organizationId,
				membershipRole: caller.membershipRole,
				employee: caller.employee,
			}),
			{ db },
		),
	);
});

const {
	recordAgriculturalDeclarationAction,
	acknowledgeShortTermBerufsmaessigkeitAction,
	getShortTermMonitorAction,
	listShortTermBerufsmaessigkeitReviewsAction,
	recordShortTermPriorEmploymentAction,
	voidShortTermPriorEmploymentAction,
} = await import("./short-term-actions");

describe("short-term employment actions (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t1990-actions");
	const st = shortTermFixture(admin, () => fx.user("creator"));
	// The Reviews inbox covers the current and previous calendar year, so seed this year's January.
	const YEAR = plainDateAt(systemClock.nowInstant(), "Europe/Berlin").year;
	const JANUARY = `${YEAR}-01`;

	beforeEach(async () => {
		st.reset();
		await fx.cleanup();
	});
	afterAll(fx.cleanup);

	/** A short-term worker earning 640 EUR in January (8 × 4 h × 20 EUR) and their managers. */
	async function seed() {
		const org = await fx.organization("a");
		const owner = await fx.user("owner");
		await fx.membership(org, owner, "owner");
		const worker = await fx.employee(org, "worker", { contractType: "hourly" });
		await st.terms(worker, { from: `${YEAR}-01-01`, hourlyRate: 20 });
		for (let day = 5; day <= 12; day++) {
			await st.work(org, worker, `${JANUARY}-${String(day).padStart(2, "0")}`);
		}
		const manager = await fx.employee(org, "manager", { role: "manager" });
		await fx.membership(org, manager, "member");
		await admin.query(
			`INSERT INTO employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 VALUES ($1, $2, true, $3)`,
			[worker.employeeId, manager.employeeId, owner.userId],
		);
		const stranger = await fx.employee(org, "stranger", { role: "manager" });
		await fx.membership(org, stranger, "member");
		return { org, owner, worker, manager, stranger };
	}

	function signInAsOwner(org: { id: string }, owner: { userId: string }) {
		Object.assign(caller, {
			userId: owner.userId,
			organizationId: org.id,
			membershipRole: "owner",
			employee: null,
		});
	}

	/** The fingerprint of January's prompt as the Reviews inbox shows it to the org admin. */
	/** The January prompt's fingerprint and total as Reviews & Conflicts shows them. */
	async function shownPrompt(): Promise<{
		expectedFingerprint: string;
		expectedTotalCents: number;
	}> {
		const result = await listShortTermBerufsmaessigkeitReviewsAction({ includeResolved: true });
		if (!result.success) throw new Error(result.error);
		const finding = result.data.find((review) => review.month === JANUARY)?.finding;
		if (!finding) throw new Error("No January prompt shown");
		return {
			expectedFingerprint: finding.inputFingerprint,
			expectedTotalCents: finding.adminDetail?.amountsCents?.total ?? 0,
		};
	}

	function signInAsManager(org: { id: string }, manager: { userId: string; employeeId: string }) {
		Object.assign(caller, {
			userId: manager.userId,
			organizationId: org.id,
			membershipRole: "member",
			employee: { id: manager.employeeId, role: "manager" },
		});
	}

	it("scopes agricultural declarations to the employment, effective date and org admin", async () => {
		const { org, owner, worker, manager } = await seed();
		const other = await fx.organization("other");
		const {
			rows: [period],
		} = await admin.query(
			"SELECT id FROM employee_employment_period WHERE organization_id=$1 AND employee_id=$2",
			[org.id, worker.employeeId],
		);
		const declaration = {
			periodId: period.id,
			employeeId: worker.employeeId,
			effectiveFrom: JANUARY + "-01",
			establishmentNumber: "01234567",
			eligible: true,
		};
		signInAsManager(org, manager);
		expect((await recordAgriculturalDeclarationAction(declaration)).success).toBe(false);
		signInAsOwner(other, owner);
		expect((await recordAgriculturalDeclarationAction(declaration)).success).toBe(false);
		signInAsOwner(org, owner);
		expect(
			(
				await recordAgriculturalDeclarationAction({
					...declaration,
					employeeId: manager.employeeId,
				})
			).success,
		).toBe(false);
		expect((await recordAgriculturalDeclarationAction(declaration)).success).toBe(true);
		expect(
			(
				await recordAgriculturalDeclarationAction({
					...declaration,
					effectiveFrom: JANUARY + "-13",
					eligible: false,
				})
			).success,
		).toBe(true);
		const read = () => getShortTermMonitorAction({ employeeId: worker.employeeId, year: YEAR });
		expect(await read()).toMatchObject({ success: true, data: { allowance: { limit: 90 } } });
		await st.work(org, worker, JANUARY + "-13");
		expect(await read()).toMatchObject({ success: true, data: { allowance: { limit: 70 } } });
	});
	it("shows org admins the allowance, prior employers and the Berufsmäßigkeit prompt", async () => {
		const { org, owner, worker } = await seed();
		signInAsOwner(org, owner);
		const recorded = await recordShortTermPriorEmploymentAction({
			employeeId: worker.employeeId,
			kind: "prior_short_term_work_days",
			calendarYear: YEAR,
			count: 20,
			sourceEmployer: "Ernte GmbH",
			note: "Certificate of prior employment",
		});
		expect(recorded.success).toBe(true);

		const result = await getShortTermMonitorAction({ employeeId: worker.employeeId, year: YEAR });

		if (!result.success) throw new Error(result.error);
		expect(result.data).toMatchObject({
			audience: "full",
			applies: true,
			allowance: { limitKind: "work_days", used: 28, ownUsed: 8, priorEmployerUsed: 20 },
			priorEmployment: [
				{ kind: "prior_short_term_work_days", count: 20, sourceEmployer: "Ernte GmbH" },
			],
		});
		expect(result.data.findings).toEqual([
			expect.objectContaining({
				kind: "short_term_berufsmaessigkeit_check",
				subjectKey: JANUARY,
				adminDetail: expect.objectContaining({
					amountsCents: expect.objectContaining({ total: 64_000 }),
				}),
				acknowledgement: expect.objectContaining({ status: "none" }),
			}),
		]);
	});

	it("shows a scoped manager the wage-free allowance of a managed employee only", async () => {
		const { org, worker, manager, stranger } = await seed();
		signInAsManager(org, manager);

		const result = await getShortTermMonitorAction({ employeeId: worker.employeeId, year: YEAR });

		if (!result.success) throw new Error(result.error);
		expect(result.data).toMatchObject({
			audience: "restricted",
			// Eight days in a row with no planned week: a full week of work, so 3 months (90 days).
			allowance: { limitKind: "months", used: 8, remaining: 82 },
			findings: [],
			priorEmployment: null,
		});
		const payload = JSON.stringify(result.data);
		for (const leak of ["64000", 'adminDetail":{', "berufsmaessigkeit", 'inputFingerprint":"v1']) {
			expect(payload).not.toContain(leak);
		}

		signInAsManager(org, stranger);
		expect(
			await getShortTermMonitorAction({ employeeId: worker.employeeId, year: YEAR }),
		).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("keeps prior-employer entries and acknowledgements for org admins", async () => {
		const { org, worker, manager } = await seed();
		signInAsManager(org, manager);

		expect(
			await recordShortTermPriorEmploymentAction({
				employeeId: worker.employeeId,
				kind: "prior_short_term_months",
				calendarYear: YEAR,
				count: 1,
				note: "Certificate",
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(
			await acknowledgeShortTermBerufsmaessigkeitAction({
				employeeId: worker.employeeId,
				month: JANUARY,
				reason: "Verified",
				expectedFingerprint: "v1:anything",
				expectedTotalCents: 0,
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("voids a prior-employer entry with a reason", async () => {
		const { org, owner, worker } = await seed();
		signInAsOwner(org, owner);
		const recorded = await recordShortTermPriorEmploymentAction({
			employeeId: worker.employeeId,
			kind: "prior_short_term_work_days",
			calendarYear: YEAR,
			count: 20,
			note: "Certificate",
		});
		if (!recorded.success) throw new Error(recorded.error);

		expect(
			await voidShortTermPriorEmploymentAction({
				employeeId: worker.employeeId,
				offsetId: recorded.data.id,
				reason: " ",
			}),
		).toMatchObject({ success: false, refusal: "statutory_note_required" });
		expect(
			await voidShortTermPriorEmploymentAction({
				employeeId: worker.employeeId,
				offsetId: recorded.data.id,
				reason: "Entered for the wrong year",
			}),
		).toMatchObject({ success: true });

		const result = await getShortTermMonitorAction({ employeeId: worker.employeeId, year: YEAR });
		expect(result).toMatchObject({
			success: true,
			data: { allowance: { used: 8 }, priorEmployment: [] },
		});
	});

	it("resolves a Berufsmäßigkeit prompt in Reviews and reopens it when the month changes", async () => {
		const { org, owner, worker } = await seed();
		signInAsOwner(org, owner);
		const open = async () => {
			const result = await listShortTermBerufsmaessigkeitReviewsAction({});
			if (!result.success) throw new Error(result.error);
			return result.data.map((review) => [review.employeeName, review.month]);
		};
		expect(await open()).toEqual([["worker", JANUARY]]);

		expect(
			await acknowledgeShortTermBerufsmaessigkeitAction({
				employeeId: worker.employeeId,
				month: JANUARY,
				reason: "Student; no other employment this year (questionnaire on file)",
				...(await shownPrompt()),
			}),
		).toMatchObject({ success: true });
		expect(await open()).toEqual([]);
		const resolved = await listShortTermBerufsmaessigkeitReviewsAction({ includeResolved: true });
		expect(resolved).toMatchObject({
			success: true,
			data: [{ month: JANUARY, finding: { acknowledgement: { status: "current" } } }],
		});

		await st.work(org, worker, `${JANUARY}-20`);
		expect(await open()).toEqual([["worker", JANUARY]]);
	});

	it("keeps another organization's admin away from the employee's monitor and records", async () => {
		const { org, owner, worker } = await seed();
		signInAsOwner(org, owner);
		const recorded = await recordShortTermPriorEmploymentAction({
			employeeId: worker.employeeId,
			kind: "prior_short_term_work_days",
			calendarYear: YEAR,
			count: 20,
			note: "Certificate",
		});
		if (!recorded.success) throw new Error(recorded.error);
		const otherOrg = await fx.organization("b");
		const otherOwner = await fx.user("other-owner");
		await fx.membership(otherOrg, otherOwner, "owner");
		signInAsOwner(otherOrg, otherOwner);

		const attempts = [
			await getShortTermMonitorAction({ employeeId: worker.employeeId, year: YEAR }),
			await recordShortTermPriorEmploymentAction({
				employeeId: worker.employeeId,
				kind: "prior_short_term_months",
				calendarYear: YEAR,
				count: 1,
				note: "Certificate",
			}),
			await voidShortTermPriorEmploymentAction({
				employeeId: worker.employeeId,
				offsetId: recorded.data.id,
				reason: "Not ours",
			}),
			await acknowledgeShortTermBerufsmaessigkeitAction({
				employeeId: worker.employeeId,
				month: JANUARY,
				reason: "Verified",
				expectedFingerprint: "v1:anything",
				expectedTotalCents: 0,
			}),
		];
		const reviews = await listShortTermBerufsmaessigkeitReviewsAction({ includeResolved: true });

		expect(attempts.map((attempt) => attempt.success)).toEqual([false, false, false, false]);
		expect(reviews).toMatchObject({ success: true, data: [] });
		signInAsOwner(org, owner);
		expect(
			await getShortTermMonitorAction({ employeeId: worker.employeeId, year: YEAR }),
		).toMatchObject({
			success: true,
			data: {
				allowance: { used: 28 },
				priorEmployment: [{ kind: "prior_short_term_work_days", count: 20 }],
				findings: [
					expect.objectContaining({
						acknowledgement: expect.objectContaining({ status: "none" }),
					}),
				],
			},
		});
	});

	it("refuses to acknowledge a month without a prompt", async () => {
		const { org, owner, worker } = await seed();
		signInAsOwner(org, owner);

		expect(
			await acknowledgeShortTermBerufsmaessigkeitAction({
				employeeId: worker.employeeId,
				month: `${YEAR}-02`,
				reason: "Verified",
				expectedFingerprint: "v1:anything",
				expectedTotalCents: 0,
			}),
		).toMatchObject({ success: false, refusal: "short_term_no_verification_prompt" });
	});

	it("refuses to acknowledge figures that changed since the admin saw them", async () => {
		const { org, owner, worker } = await seed();
		signInAsOwner(org, owner);
		const seen = await shownPrompt();
		// More work is recorded while the admin reads the old figures.
		await st.work(org, worker, `${JANUARY}-20`);

		expect(
			await acknowledgeShortTermBerufsmaessigkeitAction({
				employeeId: worker.employeeId,
				month: JANUARY,
				reason: "Verified",
				...seen,
			}),
		).toMatchObject({ success: false, refusal: "short_term_figures_changed" });
		const resolved = await listShortTermBerufsmaessigkeitReviewsAction({ includeResolved: true });
		expect(resolved).toMatchObject({
			success: true,
			data: [{ finding: { acknowledgement: { status: "none" } } }],
		});

		expect(
			await acknowledgeShortTermBerufsmaessigkeitAction({
				employeeId: worker.employeeId,
				month: JANUARY,
				reason: "Verified",
				...(await shownPrompt()),
			}),
		).toMatchObject({ success: true });
	});
});
