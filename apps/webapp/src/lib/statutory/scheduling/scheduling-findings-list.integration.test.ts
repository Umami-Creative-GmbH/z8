/**
 * #2026: Scheduling lists the statutory findings behind its counts (real PostgreSQL). A scoped
 * manager's payload holds only the findings of employees they manage, named, and nothing an org
 * admin alone may see: no wage, EUR amount, input fingerprint or acknowledgement reason. The
 * publish-block refusal lists its blocking findings the same way.
 */
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { shift as shiftTable } from "@/db/schema";
import { integrationAdminPool } from "@/test/integration-database";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";
import type { StatutoryScheduleContext, StatutoryScheduleContributor } from "./contributor";
import { STATUTORY_PUBLICATION_BLOCKED } from "./publication-block";

const caller = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	membershipRole: "owner" as "owner" | "member",
	employee: null as { id: string; role: "manager" | "admin" | "employee"; former: boolean } | null,
}));

/**
 * Minijob month (earnings-derived, with EUR admin detail) and a youth daily maximum, blocking
 * unless `youthBlocks` is off.
 */
const fakeContributors = vi.hoisted(() => {
	const settings = { youthBlocks: true };
	const minijob = {
		domain: "minijob",
		evaluate: async (context: StatutoryScheduleContext) =>
			context.employeeIds.map((employeeId) => ({
				id: `minijob_monthly_cap:${employeeId}:2027-03`,
				organizationId: context.organizationId,
				employeeId,
				domain: "minijob",
				kind: "minijob_monthly_cap",
				severity: "critical",
				subjectKey: "2027-03",
				periodStart: "2027-03-01",
				periodEnd: "2027-04-01",
				legalReference: "§ 8 Abs. 1 Nr. 1 SGB IV",
				summary: { tier: "exceeded", usedPercent: 104 },
				adminDetail: {
					currency: "EUR",
					amountsCents: { earned: 62_700, cap: 60_300 },
					hourlyWageCents: 1_390,
				},
				inputFingerprint: "v1:secret-fingerprint",
				acknowledgementKind: "minijob_unforeseeable_exceedance",
				acknowledgement: {
					status: "stale",
					acknowledgedAt: new Date("2027-03-01T10:00:00Z"),
					acknowledgedBy: "admin-user",
					reason: "Christmas rush covered for a sick colleague",
				},
			})),
	};
	const youth = {
		domain: "youth_protection",
		evaluate: async (context: StatutoryScheduleContext) => {
			const { db } = context;
			const { shift } = await import("@/db/schema");
			const { and, eq, inArray } = await import("drizzle-orm");
			if (context.employeeIds.length === 0) return [];
			const drafts = await db
				.select({ id: shift.id, employeeId: shift.employeeId })
				.from(shift)
				.where(
					and(
						eq(shift.organizationId, context.organizationId),
						inArray(shift.employeeId, [...context.employeeIds]),
					),
				);
			return drafts
				.filter((row) => !context.excludedShiftIds?.includes(row.id))
				.map((row) => ({
					id: `jarbschg_daily_max:${row.employeeId}:shift:${row.id}`,
					organizationId: context.organizationId,
					employeeId: row.employeeId as string,
					domain: "youth_protection",
					kind: "jarbschg_daily_max",
					severity: "critical",
					subjectKey: `shift:${row.id}`,
					periodStart: "2027-03-02",
					periodEnd: "2027-03-03",
					legalReference: "§ 8 Abs. 1 JArbSchG",
					summary: {
						tier: "exceeded",
						used: { unit: "minutes", value: 600 },
						limit: { unit: "minutes", value: 480 },
					},
					adminDetail: null,
					inputFingerprint: "v1:youth-fingerprint",
					acknowledgementKind: null,
					blocksPublication: settings.youthBlocks,
				}));
		},
	};
	return { minijob, youth, settings };
});

vi.mock("@/lib/statutory/scheduling/contributors", () => ({
	statutoryScheduleContributors: [
		fakeContributors.minijob,
		fakeContributors.youth,
	] as unknown as StatutoryScheduleContributor[],
	statutoryBlockingScheduleContributors: [
		fakeContributors.youth,
	] as unknown as StatutoryScheduleContributor[],
}));

/** Runs as the publication's transaction starts, before it locks the range's drafts. */
const publication = vi.hoisted(() => ({ beforeLock: null as null | (() => Promise<void>) }));

vi.mock("@/lib/statutory/scheduling/publish-blocking", async (importOriginal) => {
	const original = await importOriginal<typeof import("./publish-blocking")>();
	return {
		...original,
		lockPublicationDrafts: async (...args: Parameters<typeof original.lockPublicationDrafts>) => {
			const beforeLock = publication.beforeLock;
			publication.beforeLock = null;
			await beforeLock?.();
			return original.lockPublicationDrafts(...args);
		},
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Layer } = await import("effect");
	const { db } = await import("@/db");
	const { ShiftServiceLive } = await import("@/lib/effect/services/shift.service");
	const { CoverageServiceLive } = await import("@/lib/effect/services/coverage.service");
	const { WorkPolicyServiceLive } = await import("@/lib/effect/services/work-policy.service");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const boundary = organizationActionStubLayer(
		() => ({
			userId: caller.userId,
			activeOrganizationId: caller.organizationId,
			membershipRole: caller.membershipRole,
			employee: caller.employee,
		}),
		{ db },
	);
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		Layer.mergeAll(ShiftServiceLive, CoverageServiceLive, WorkPolicyServiceLive).pipe(
			Layer.provideMerge(boundary),
		),
	);
});

const { getScheduleComplianceSummary, publishShifts } =
	await import("@/app/[locale]/(app)/scheduling/actions/shift-actions");
const { db } = await import("@/db");

const WEEK = { startDate: "2027-03-01", endDateExclusive: "2027-03-08" };

/** Anything an org admin alone may see, in any form a payload could carry it. */
const ADMIN_ONLY =
	/adminDetail|inputFingerprint|secret-fingerprint|youth-fingerprint|amountsCents|hourlyWage|currency|EUR|€|62700|60300|1390|Christmas rush|acknowledgedBy|"reason"/;

describe("statutory findings listed in Scheduling (PostgreSQL)", () => {
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t2026sl");
	let org: FixtureOrganization;
	let owner: FixtureEmployee;
	let manager: FixtureEmployee;
	let managed: FixtureEmployee;
	let other: FixtureEmployee;
	let subareaId: string;

	beforeEach(async () => {
		vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
		manager = await fx.employee(org, "manager", { role: "manager" });
		await fx.membership(org, manager, "member");
		managed = await fx.employee(org, "managed");
		other = await fx.employee(org, "other");
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[managed.employeeId, manager.employeeId, owner.userId],
		);
		const locationId = crypto.randomUUID();
		subareaId = crypto.randomUUID();
		await admin.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, now())`,
			[locationId, org.id, owner.userId],
		);
		await admin.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at)
			 values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, owner.userId],
		);
		publication.beforeLock = null;
		fakeContributors.settings.youthBlocks = true;
		await insertDrafts();
	});
	afterAll(fx.cleanup);

	/** A 10-hour draft on 2 March for the managed and the other employee. */
	const insertDrafts = async () => {
		for (const who of [managed, other]) {
			await admin.query(
				`insert into shift
				 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
				 values ($1, $2, $3, $4, '2027-03-01T23:00:00Z', '08:00', '18:00', 'draft', $5, now())`,
				[crypto.randomUUID(), org.id, who.employeeId, subareaId, owner.userId],
			);
		}
	};

	const blockJArbSchGPublishing = () =>
		admin.query(
			`insert into organization_statutory_preference (organization_id, block_jarbschg_shift_publish)
			 values ($1, true)
			 on conflict (organization_id) do update set block_jarbschg_shift_publish = true`,
			[org.id],
		);

	const draftStatuses = async () =>
		(
			await db
				.select({ status: shiftTable.status })
				.from(shiftTable)
				.where(
					and(
						eq(shiftTable.organizationId, org.id),
						inArray(shiftTable.employeeId, [managed.employeeId, other.employeeId]),
					),
				)
		).map((row) => row.status);

	const signInAs = (
		who: FixtureEmployee,
		membershipRole: "owner" | "member",
		role: "manager" | "admin",
	) => {
		caller.userId = who.userId;
		caller.organizationId = org.id;
		caller.membershipRole = membershipRole;
		caller.employee = { id: who.employeeId, role, former: false };
	};

	it("gives a scoped manager only their managed employees' findings, wage-free and named", async () => {
		signInAs(manager, "member", "manager");

		const result = await getScheduleComplianceSummary(WEEK);
		if (!result.success) throw new Error(result.error);
		const { statutoryFindings } = result.data;

		expect(statutoryFindings.items.map((item) => item.finding.employeeId)).toEqual([
			managed.employeeId,
			managed.employeeId,
		]);
		expect(statutoryFindings.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					employeeName: "managed",
					period: { start: "2027-03-01", endExclusive: "2027-04-01" },
					finding: expect.objectContaining({
						statutoryKind: "minijob_monthly_cap",
						// Earnings-derived: the tier alone.
						summary: { tier: "exceeded" },
						acknowledgementStatus: "stale",
					}),
				}),
				expect.objectContaining({
					employeeName: "managed",
					period: { start: "2027-03-02", endExclusive: "2027-03-03" },
					finding: expect.objectContaining({
						statutoryKind: "jarbschg_daily_max",
						day: "2027-03-02",
						blocksPublication: true,
					}),
				}),
			]),
		);
		// The other employee's two findings are counted, never named.
		expect(statutoryFindings.outsideScopeCount).toBe(2);
		expect(statutoryFindings.canOpenReviews).toBe(false);
		const payload = JSON.stringify(statutoryFindings);
		expect(payload).not.toContain(other.employeeId);
		expect(payload).not.toContain("other");
		expect(payload).not.toMatch(ADMIN_ONLY);
	});

	it("lists only the scoped manager's blocking findings in the publish-block refusal", async () => {
		await blockJArbSchGPublishing();
		signInAs(manager, "member", "manager");

		const refused = await publishShifts(WEEK);
		if (refused.success) throw new Error("expected the publish block to refuse");
		expect(refused.refusal).toBe(STATUTORY_PUBLICATION_BLOCKED);
		const listed = refused.details?.statutoryFindings as {
			items: { employeeName: string; finding: { statutoryKind: string; employeeId: string } }[];
			outsideScopeCount: number;
		};
		expect(listed.items).toEqual([
			expect.objectContaining({
				employeeName: "managed",
				finding: expect.objectContaining({
					employeeId: managed.employeeId,
					statutoryKind: "jarbschg_daily_max",
				}),
			}),
		]);
		expect(listed.outsideScopeCount).toBe(1);
		expect(JSON.stringify(refused.details)).not.toMatch(ADMIN_ONLY);
		expect(await draftStatuses()).toEqual(["draft", "draft"]);
	});

	it("lists only the scoped manager's findings, wage-free, when the publication refuses drafts saved after its check", async () => {
		await blockJArbSchGPublishing();
		// The range is empty when the action checks it; both drafts are saved before the
		// publication's transaction locks the range.
		await db.delete(shiftTable).where(eq(shiftTable.organizationId, org.id));
		publication.beforeLock = insertDrafts;
		signInAs(manager, "member", "manager");

		const refused = await publishShifts(WEEK);
		if (refused.success) throw new Error("expected the publication to refuse its locked drafts");
		expect(refused.refusal).toBe(STATUTORY_PUBLICATION_BLOCKED);
		const listed = refused.details?.statutoryFindings as {
			items: { employeeName: string; finding: { statutoryKind: string; employeeId: string } }[];
			outsideScopeCount: number;
			canOpenReviews: boolean;
		};
		expect(listed.items).toEqual([
			expect.objectContaining({
				employeeName: "managed",
				finding: expect.objectContaining({
					employeeId: managed.employeeId,
					statutoryKind: "jarbschg_daily_max",
				}),
			}),
		]);
		expect(listed.outsideScopeCount).toBe(1);
		expect(listed.canOpenReviews).toBe(false);
		// The service's unscoped blocking findings never reach the viewer.
		expect(Object.keys(refused.details ?? {})).toEqual(["statutoryFindings"]);
		const payload = JSON.stringify(refused.details);
		expect(payload).not.toContain(other.employeeId);
		expect(payload).not.toMatch(ADMIN_ONLY);
		expect(await draftStatuses()).toEqual(["draft", "draft"]);
	});

	it("asks a scoped manager to acknowledge only their managed employees' findings, wage-free", async () => {
		// Nothing blocks: the planner is asked to acknowledge the findings instead.
		fakeContributors.settings.youthBlocks = false;
		signInAs(manager, "member", "manager");

		const result = await publishShifts(WEEK);
		if (!result.success) throw new Error(result.error);
		if (result.data.published) throw new Error("expected the planner to be asked to acknowledge");
		expect(result.data.requiresAcknowledgment).toBe(true);
		const { statutoryFindings } = result.data;
		if (!statutoryFindings) throw new Error("expected the findings being acknowledged");

		expect(statutoryFindings.items.map((item) => item.finding.statutoryKind).toSorted()).toEqual([
			"jarbschg_daily_max",
			"minijob_monthly_cap",
		]);
		expect(statutoryFindings.items.every((item) => item.employeeName === "managed")).toBe(true);
		expect(statutoryFindings.outsideScopeCount).toBe(2);
		expect(statutoryFindings.canOpenReviews).toBe(false);
		const payload = JSON.stringify(statutoryFindings);
		expect(payload).not.toContain(other.employeeId);
		expect(payload).not.toMatch(ADMIN_ONLY);
		expect(await draftStatuses()).toEqual(["draft", "draft"]);
	});

	it("gives a workforce admin every employee's findings, without the way to Reviews & Conflicts", async () => {
		signInAs(manager, "member", "admin");

		const result = await getScheduleComplianceSummary(WEEK);
		if (!result.success) throw new Error(result.error);
		const { statutoryFindings } = result.data;

		expect(statutoryFindings.items.map((item) => item.employeeName).toSorted()).toEqual([
			"managed",
			"managed",
			"other",
			"other",
		]);
		expect(statutoryFindings.outsideScopeCount).toBe(0);
		expect(statutoryFindings.canOpenReviews).toBe(false);
		expect(JSON.stringify(statutoryFindings)).not.toMatch(ADMIN_ONLY);
	});

	it("gives an org admin every employee's findings and the way to Reviews & Conflicts", async () => {
		signInAs(owner, "owner", "admin");

		const result = await getScheduleComplianceSummary(WEEK);
		if (!result.success) throw new Error(result.error);
		const { statutoryFindings } = result.data;

		expect(new Set(statutoryFindings.items.map((item) => item.employeeName))).toEqual(
			new Set(["managed", "other"]),
		);
		expect(statutoryFindings.outsideScopeCount).toBe(0);
		expect(statutoryFindings.canOpenReviews).toBe(true);
		// Scheduling stays wage-free for org admins too: amounts live in Reviews & Conflicts.
		expect(JSON.stringify(statutoryFindings)).not.toMatch(ADMIN_ONLY);
	});
});
