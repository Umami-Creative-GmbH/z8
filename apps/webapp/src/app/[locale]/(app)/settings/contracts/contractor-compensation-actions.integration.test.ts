/**
 * Contractor compensation actions against PostgreSQL (#1998): org admins read
 * and change contractor terms and details; scoped managers and members are
 * refused before any read, so contractor rates never reach them. Only the
 * request/session and the SSO/MFA organization gate are replaced.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	activeOrganizationId: null as string | null,
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user", name: "Caller", email: "c@example.test" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.activeOrganizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/organization-mfa/organization-access", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/organization-mfa/organization-access")>()),
	canAccessOrganization: async () => true,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: async (href: string) => {
		throw new Error(`redirect:${href}`);
	},
}));

const {
	endContractorTerms,
	getContractorCompensation,
	listContractorCompensation,
	setContractorTerms,
	updateContractorDetails,
} = await import("./contractor-compensation-actions");

describe("contractor compensation actions on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let contractorId: string;
	let employeeId: string;
	const users: Record<string, string> = {};

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		users.admin = (await fixture.seedEmployee({ role: "admin" })).userId;

		const contractor = await fixture.seedEmployee({ engagementKind: "contractor" });
		contractorId = contractor.employeeId;
		users.contractor = contractor.userId;
		employeeId = (await fixture.seedEmployee()).employeeId;

		// A scoped manager who manages the contractor directly.
		const manager = await fixture.seedEmployee();
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[contractorId, manager.employeeId, fixture.ownerUserId],
		);
		users.scopedManager = manager.userId;
		users.member = (await fixture.seedEmployee()).userId;

		const otherOrganization = await fixture.createOrganization();
		users.otherOwner = (
			await fixture.seedEmployee({ organizationId: otherOrganization, role: "owner" })
		).userId;
		users.otherOrganization = otherOrganization;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function signIn(userId: string, organizationId = fixture.organizationId) {
		harness.userId = userId;
		harness.activeOrganizationId = organizationId;
	}

	const dailyTerms = {
		basis: "daily" as const,
		rateAmount: "720",
		currency: "EUR",
		dayUnitRule: "prorated_by_standard_day" as const,
		standardDayMinutes: 480,
		capAtOneDay: true,
	};

	it("lets an org admin set, read and end a contractor's terms", async () => {
		signIn(users.admin);

		const set = await setContractorTerms({
			employeeId: contractorId,
			effectiveFrom: "2026-02-01",
			compensation: dailyTerms,
		});
		expect(set).toMatchObject({ success: true, data: { changed: true } });

		const read = await getContractorCompensation({ employeeId: contractorId });
		expect(read).toMatchObject({
			success: true,
			data: {
				activeEngagementKind: "contractor",
				engagementStartDate: "2026-01-01",
				history: [
					{
						effectiveFrom: "2026-02-01",
						effectiveTo: null,
						compensation: {
							compensationBasis: "daily",
							rateAmount: "720.00",
							dayUnitRule: "prorated_by_standard_day",
							standardDayMinutes: 480,
							capAtOneDay: true,
						},
					},
				],
			},
		});

		const ended = await endContractorTerms({
			employeeId: contractorId,
			effectiveFrom: "2026-06-01",
		});
		expect(ended).toMatchObject({
			success: true,
			data: { history: [{ effectiveFrom: "2026-02-01", effectiveTo: "2026-06-01" }] },
		});
	});

	it("lists contractors with today's terms for org admins", async () => {
		signIn(users.admin);
		const result = await listContractorCompensation();
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.map((row) => row.employeeId)).toEqual([contractorId]);
	});

	it("saves the contracting company, VAT ID and PO reference", async () => {
		signIn(users.admin);
		expect(
			await updateContractorDetails({
				employeeId: contractorId,
				companyName: "  Freelance GmbH ",
				vatId: "DE123456789",
				referenceCode: "",
			}),
		).toEqual({
			success: true,
			data: { companyName: "Freelance GmbH", vatId: "DE123456789", referenceCode: null },
		});
		expect(await getContractorCompensation({ employeeId: contractorId })).toMatchObject({
			data: { details: { companyName: "Freelance GmbH" } },
		});
	});

	it("refuses terms and details for an employee with a refusal code", async () => {
		signIn(users.admin);
		expect(
			await setContractorTerms({
				employeeId,
				effectiveFrom: "2026-02-01",
				compensation: { basis: "hourly", rateAmount: "90", currency: "EUR" },
			}),
		).toMatchObject({ success: false, code: "ValidationError", refusal: "not_contractor" });
		expect(await updateContractorDetails({ employeeId, companyName: "Nope" })).toMatchObject({
			success: false,
			refusal: "not_contractor",
		});
	});

	it("words an invalid daily rule as a refusal", async () => {
		signIn(users.admin);
		expect(
			await setContractorTerms({
				employeeId: contractorId,
				effectiveFrom: "2026-07-01",
				compensation: {
					basis: "daily",
					rateAmount: "720",
					currency: "EUR",
					dayUnitRule: "half_and_full_day",
					halfDayThresholdMinutes: 1441,
				},
			}),
		).toMatchObject({ success: false, refusal: "invalid_half_day_threshold" });
	});

	it.each(["scopedManager", "member", "contractor"])(
		"withholds contractor rates from a %s",
		async (caller) => {
			signIn(users[caller]);

			for (const result of [
				await getContractorCompensation({ employeeId: contractorId }),
				await listContractorCompensation(),
				await setContractorTerms({
					employeeId: contractorId,
					effectiveFrom: "2026-08-01",
					compensation: { basis: "hourly", rateAmount: "1", currency: "EUR" },
				}),
				await endContractorTerms({ employeeId: contractorId, effectiveFrom: "2026-08-01" }),
				await updateContractorDetails({ employeeId: contractorId, companyName: "Mine" }),
			]) {
				expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
				expect(JSON.stringify(result)).not.toContain("720");
			}
		},
	);

	it("never reaches a contractor of another organization", async () => {
		signIn(users.otherOwner, users.otherOrganization);
		expect(await getContractorCompensation({ employeeId: contractorId })).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(
			await setContractorTerms({
				employeeId: contractorId,
				effectiveFrom: "2026-08-01",
				compensation: { basis: "hourly", rateAmount: "1", currency: "EUR" },
			}),
		).toMatchObject({ success: false, code: "NotFoundError" });
	});
});
