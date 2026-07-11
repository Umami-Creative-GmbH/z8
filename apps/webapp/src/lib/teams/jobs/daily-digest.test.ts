import { beforeEach, describe, expect, it, vi } from "vitest";

const absenceFindFirstMock = vi.fn();

vi.mock("@/db", () => ({
	db: {
		query: {
			absenceEntry: { findFirst: absenceFindFirstMock },
		},
	},
}));
vi.mock("@/db/auth-schema", () => ({ user: {} }));
vi.mock("@/db/schema", () => ({
	absenceCategory: {},
	absenceEntry: {},
	approvalRequest: {},
	complianceException: {},
	employee: {},
	employeeManagers: {},
	location: {},
	locationSubarea: {},
	shift: {},
	workPeriod: {},
}));
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/bot-platform/i18n", () => ({
	fmtTime: vi.fn(),
	fmtWeekdayShortDate: vi.fn(),
	getBotTranslate: vi.fn(),
}));
vi.mock("@/lib/bot-platform/temporal-context", () => ({
	resolveBotTemporalContext: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("@/tolgee/shared", () => ({ DEFAULT_LANGUAGE: "en" }));
vi.mock("../bot-adapter", () => ({ sendAdaptiveCard: vi.fn() }));
vi.mock("../cards/daily-digest-card", () => ({ buildDailyDigestCard: vi.fn() }));
vi.mock("../conversation-manager", () => ({ getOrganizationPersonalConversations: vi.fn() }));
vi.mock("../tenant-resolver", () => ({ getAllActiveTenants: vi.fn() }));

describe("shouldSkipDigestForManager", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("skips a manager with an approved non-working absence in the organization", async () => {
		absenceFindFirstMock.mockResolvedValue({ category: { requiresWorkTime: false } });
		const { shouldSkipDigestForManager } = await import("./daily-digest");

		await expect(
			shouldSkipDigestForManager("employee-1", "organization-1", "Europe/Berlin"),
		).resolves.toBe(true);
	});
});
