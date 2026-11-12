import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	transaction: vi.fn(),
	orderBy: vi.fn(),
	isPersonnelFilesEnabled: vi.fn(),
	currentRosterAmong: vi.fn(),
	listActivePersonnelFileOfficerGrants: vi.fn(),
	savePersonnelFileOfficerGrant: vi.fn(),
	revokePersonnelFileOfficerGrant: vi.fn(),
	saveExpiryReminderLeadDays: vi.fn(),
	loadRetentionPeriods: vi.fn(),
	saveRetentionPeriods: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const chain = {
		from: () => chain,
		innerJoin: () => chain,
		where: () => chain,
		orderBy: mocks.orderBy,
	};
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { select: () => chain, transaction: mocks.transaction },
			// Like the real service: a rejection becomes a `DatabaseError` with its cause.
			query: (name, fn) =>
				Effect.tryPromise({
					try: fn,
					catch: (cause) => new DatabaseError({ message: name, operation: name, cause }),
				}),
		}),
	);
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/personnel-file/access-store", () => ({
	isPersonnelFilesEnabled: mocks.isPersonnelFilesEnabled,
}));
vi.mock("@/lib/employee-lifecycle/current-roster-among", () => ({
	currentRosterAmong: mocks.currentRosterAmong,
}));
vi.mock("@/lib/personnel-file/officer-grant-store", () => ({
	listActivePersonnelFileOfficerGrants: mocks.listActivePersonnelFileOfficerGrants,
	savePersonnelFileOfficerGrant: mocks.savePersonnelFileOfficerGrant,
	revokePersonnelFileOfficerGrant: mocks.revokePersonnelFileOfficerGrant,
}));
vi.mock("@/lib/personnel-file/expiry-store", () => ({
	saveExpiryReminderLeadDays: mocks.saveExpiryReminderLeadDays,
}));
vi.mock("@/lib/personnel-file/retention-store", () => ({
	loadRetentionPeriods: mocks.loadRetentionPeriods,
	saveRetentionPeriods: mocks.saveRetentionPeriods,
}));

const {
	getPersonnelFileOfficerAdminData,
	revokePersonnelFileOfficerGrantAction,
	savePersonnelFileOfficerGrantAction,
} = await import("./officer-actions");
const { savePersonnelFileExpiryLeadDaysAction } = await import("./reminder-actions");
const { getPersonnelFileRetentionSettingsAction, savePersonnelFileRetentionSettingsAction } =
	await import("./retention-actions");

const OFFICER = "33333333-3333-4333-8333-333333333333";
const GRANT = "44444444-4444-4444-8444-444444444444";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: { id: "employee-1", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

const grant = {
	officerEmployeeId: OFFICER,
	scope: "all" as const,
	teamIds: [],
	employeeIds: [],
	categories: ["payslip" as const],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.transaction.mockImplementation((work: (tx: unknown) => Promise<unknown>) => work({}));
	mocks.orderBy.mockResolvedValue([]);
	mocks.isPersonnelFilesEnabled.mockResolvedValue(true);
	mocks.currentRosterAmong.mockImplementation(async (_db, _org, ids: string[]) => new Set(ids));
	mocks.listActivePersonnelFileOfficerGrants.mockResolvedValue([]);
	mocks.savePersonnelFileOfficerGrant.mockResolvedValue({ grantId: GRANT, outcome: "created" });
	mocks.revokePersonnelFileOfficerGrant.mockResolvedValue({
		grantId: GRANT,
		officerEmployeeId: OFFICER,
	});
	mocks.saveExpiryReminderLeadDays.mockResolvedValue(undefined);
	mocks.loadRetentionPeriods.mockResolvedValue({ payslip: 6 });
	mocks.saveRetentionPeriods.mockResolvedValue({ kind: "saved", changed: ["payslip"] });
});

const calls = [
	["getPersonnelFileOfficerAdminData", () => getPersonnelFileOfficerAdminData()],
	["savePersonnelFileOfficerGrantAction", () => savePersonnelFileOfficerGrantAction(grant)],
	[
		"revokePersonnelFileOfficerGrantAction",
		() => revokePersonnelFileOfficerGrantAction({ grantId: GRANT }),
	],
	[
		"savePersonnelFileExpiryLeadDaysAction",
		() => savePersonnelFileExpiryLeadDaysAction({ leadDays: 14 }),
	],
	["getPersonnelFileRetentionSettingsAction", () => getPersonnelFileRetentionSettingsAction()],
	[
		"savePersonnelFileRetentionSettingsAction",
		() => savePersonnelFileRetentionSettingsAction({ periods: { payslip: 6 } }),
	],
] as const;

const storeMocks = () => [
	mocks.orderBy,
	mocks.savePersonnelFileOfficerGrant,
	mocks.revokePersonnelFileOfficerGrant,
	mocks.saveExpiryReminderLeadDays,
	mocks.loadRetentionPeriods,
	mocks.saveRetentionPeriods,
];

describe("personnel file settings actions", () => {
	it.each(calls)("%s refuses a scoped manager", async (_name, call) => {
		mocks.caller = scopedManager;

		expect(await call()).toMatchObject({ success: false, code: "AuthorizationError" });
		for (const store of storeMocks()) expect(store).not.toHaveBeenCalled();
	});

	it.each(calls)("%s succeeds for an owner", async (_name, call) => {
		expect(await call()).toMatchObject({ success: true });
	});

	it.each(calls)("%s is refused while personnel files are off", async (_name, call) => {
		mocks.isPersonnelFilesEnabled.mockResolvedValue(false);

		expect(await call()).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "personnel_files_off",
		});
		for (const store of storeMocks()) expect(store).not.toHaveBeenCalled();
	});

	it("saves a grant for the session's organization, as the caller", async () => {
		expect(await savePersonnelFileOfficerGrantAction(grant)).toEqual({
			success: true,
			data: { grantId: GRANT },
		});
		expect(mocks.savePersonnelFileOfficerGrant).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			actorUserId: "user-1",
			grant,
		});
	});

	it("refuses a former employee as the officer", async () => {
		mocks.currentRosterAmong.mockResolvedValue(new Set());

		expect(await savePersonnelFileOfficerGrantAction(grant)).toMatchObject({
			success: false,
			refusal: "former_employee",
		});
		expect(mocks.savePersonnelFileOfficerGrant).not.toHaveBeenCalled();
	});

	it("shows the store's validation and not-found messages", async () => {
		mocks.savePersonnelFileOfficerGrant.mockRejectedValue(
			new ValidationError({
				message: "A personnel file officer needs at least one document category",
			}),
		);
		expect(await savePersonnelFileOfficerGrantAction({ ...grant, categories: [] })).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "A personnel file officer needs at least one document category",
		});

		mocks.revokePersonnelFileOfficerGrant.mockRejectedValue(
			new NotFoundError({
				message: "Personnel file officer grant not found",
				entityType: "personnel_file_officer_grant",
			}),
		);
		expect(await revokePersonnelFileOfficerGrantAction({ grantId: GRANT })).toMatchObject({
			success: false,
			code: "NotFoundError",
			error: "Personnel file officer grant not found",
		});
	});

	it("takes the reminder lead time as a number or a numeric string", async () => {
		expect(await savePersonnelFileExpiryLeadDaysAction({ leadDays: "14" })).toEqual({
			success: true,
			data: { leadDays: 14 },
		});
		expect(mocks.saveExpiryReminderLeadDays).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			leadDays: 14,
			actorUserId: "user-1",
		});
	});

	it("refuses a lead time outside 1 to 365 days", async () => {
		expect(await savePersonnelFileExpiryLeadDaysAction({ leadDays: 0 })).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Enter a lead time between 1 and 365 days.",
		});
		expect(mocks.saveExpiryReminderLeadDays).not.toHaveBeenCalled();
	});

	it("lists a period and the suggestion for every category", async () => {
		const result = await getPersonnelFileRetentionSettingsAction();

		expect(result.success && result.data.periods).toEqual({
			contract: null,
			payslip: 6,
			certificate: null,
			sick_note: null,
			other: null,
		});
		expect(result.success && result.data.suggestions.payslip.years).toBeGreaterThan(0);
	});

	it("refuses a retention period the store rejects, naming its category", async () => {
		mocks.saveRetentionPeriods.mockResolvedValue({ kind: "invalid", category: "payslip" });

		expect(
			await savePersonnelFileRetentionSettingsAction({ periods: { payslip: 2.5 } }),
		).toMatchObject({ success: false, code: "ValidationError", refusal: "invalid_payslip" });
	});

	it("refuses an unknown retention category", async () => {
		const result = await savePersonnelFileRetentionSettingsAction({
			periods: { unknown: 3 } as never,
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.saveRetentionPeriods).not.toHaveBeenCalled();
	});
});
