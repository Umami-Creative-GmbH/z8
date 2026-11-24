/**
 * #2022: org admins document minor contractor engagements from Reviews & Conflicts (real
 * PostgreSQL); everyone below org admin is refused, and an acknowledgement records an audited
 * statutory acknowledgement of the engagement the admin was shown.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { systemClock } from "@/lib/datetime/temporal-core";
import { youthSeed } from "@/lib/statutory/youth/testing/youth-seed";
import { integrationAdminPool } from "@/test/integration-database";
import type { StubCaller } from "@/test/organization-action";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";

const harness = vi.hoisted(() => ({ caller: null as StubCaller | null }));

vi.mock("@/lib/effect/runtime", async () => {
	const { db } = await import("@/db");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		organizationActionStubLayer(() => harness.caller, { db }),
	);
});

const { acknowledgeMinorContractorReviewAction, listMinorContractorReviewsAction } =
	await import("./minor-contractor-review-actions");

const today = () => systemClock.nowInstant().toZonedDateTimeISO("Europe/Berlin").toPlainDate();

describe("minor contractor review actions (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const fx = statutoryFixture(admin, "t2022ra");
	const seed = youthSeed(admin);
	let org: FixtureOrganization;
	let owner: FixtureEmployee;
	let manager: FixtureEmployee;
	let minor: FixtureEmployee;

	const asOwner = () => {
		harness.caller = {
			userId: owner.userId,
			activeOrganizationId: org.id,
			membershipRole: "owner",
			employee: { id: owner.employeeId, role: "admin", former: false },
		};
	};
	const asManager = () => {
		harness.caller = {
			userId: manager.userId,
			activeOrganizationId: org.id,
			membershipRole: "member",
			employee: { id: manager.employeeId, role: "manager", former: false },
		};
	};

	beforeEach(async () => {
		await fx.cleanup();
		org = await fx.organization("a");
		owner = await fx.employee(org, "owner", { role: "admin" });
		await fx.membership(org, owner, "owner");
		manager = await fx.employee(org, "manager", { role: "manager" });
		await fx.membership(org, manager, "member");
		minor = await fx.employee(org, "minor", {
			birthday: today().subtract({ years: 16 }).toString(),
		});
		await seed.engagement(org, minor, {
			kind: "contractor",
			from: today().subtract({ months: 1 }).toString(),
			until: null,
		});
		asOwner();
	});
	afterAll(fx.cleanup);

	it("lists and documents a minor contractor engagement for an org admin", async () => {
		const listed = await listMinorContractorReviewsAction({});
		if (!listed.success) throw new Error(listed.error);
		const [review] = listed.data;
		expect(review).toMatchObject({ employeeId: minor.employeeId, acknowledgementStatus: "none" });

		expect(
			await acknowledgeMinorContractorReviewAction({
				employeeId: minor.employeeId,
				subjectKey: review.subjectKey,
				expectedFingerprint: review.inputFingerprint,
				reason: "Self-employed tutoring for several clients",
				legalNote: null,
			}),
		).toMatchObject({ success: true });

		expect(await listMinorContractorReviewsAction({})).toMatchObject({ success: true, data: [] });
		const { rows } = await admin.query(
			`select review_kind, finding_kind, acknowledged_by, note from contract_review_acknowledgement
			 where organization_id = $1 and employee_id = $2`,
			[org.id, minor.employeeId],
		);
		expect(rows).toEqual([
			{
				review_kind: "jarbschg_minor_contractor_review",
				finding_kind: "jarbschg_minor_contractor",
				acknowledged_by: owner.userId,
				note: "Self-employed tutoring for several clients",
			},
		]);
	});

	it("refuses a scoped manager both the list and the acknowledgement", async () => {
		const listed = await listMinorContractorReviewsAction({});
		if (!listed.success) throw new Error(listed.error);
		const [review] = listed.data;
		asManager();

		expect(await listMinorContractorReviewsAction({})).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			await acknowledgeMinorContractorReviewAction({
				employeeId: minor.employeeId,
				subjectKey: review.subjectKey,
				expectedFingerprint: review.inputFingerprint,
				reason: "Not my call",
			}),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		const { rows } = await admin.query(
			"select 1 from contract_review_acknowledgement where organization_id = $1",
			[org.id],
		);
		expect(rows).toEqual([]);
	});

	it("refuses an acknowledgement without a reason", async () => {
		const listed = await listMinorContractorReviewsAction({});
		if (!listed.success) throw new Error(listed.error);
		const [review] = listed.data;

		expect(
			await acknowledgeMinorContractorReviewAction({
				employeeId: minor.employeeId,
				subjectKey: review.subjectKey,
				expectedFingerprint: review.inputFingerprint,
				reason: "   ",
			}),
		).toMatchObject({ success: false, refusal: "statutory_reason_required" });
	});
});
