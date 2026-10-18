import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	context: vi.fn(),
	settings: vi.fn(),
	personnel: vi.fn(),
	defaults: vi.fn(),
	notice: vi.fn(),
	redirect: vi.fn((href: string) => {
		throw new Error(`redirect:${href}`);
	}),
}));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsRouteContext: mocks.context,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirect,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/absences/absence-settings", () => ({
	loadAbsenceSettings: mocks.settings,
}));
vi.mock("@/lib/absences/default-absence-categories", () => ({
	ensureDefaultAbsenceCategoriesForOrganization: mocks.defaults,
}));
vi.mock("@/lib/absences/proration-notice-store", () => ({
	loadProrationNoticeForPage: mocks.notice,
}));
vi.mock("@/lib/absences/working-week-notice-store", () => ({
	loadWorkingWeekNoticeForPage: mocks.notice,
}));
vi.mock("@/lib/personnel-file/access-store", () => ({
	isPersonnelFilesEnabled: mocks.personnel,
}));
vi.mock("@/components/settings/holiday/holiday-management", () => ({
	HolidayManagement: () => null,
}));
vi.mock("@/components/settings/vacation/vacation-management", () => ({
	VacationManagement: () => null,
}));
vi.mock("@/components/settings/vacation/vacation-policies-table", () => ({
	VacationPoliciesTable: () => null,
}));
vi.mock("@/components/settings/vacation/employee-sick-note-setting", () => ({
	EmployeeSickNoteSetting: () => null,
}));
vi.mock("@/components/settings/vacation/proration-notice", () => ({
	ProrationNotice: () => null,
}));
vi.mock("@/components/settings/vacation/working-week-notice", () => ({
	WorkingWeekNotice: () => null,
}));
vi.mock("@/components/settings/vacation/absence-settings-tabs", () => ({
	AbsenceSettingsTabs: () => null,
}));

import LegacyHolidayPage from "../holidays/page";
import AbsencePage from "./page";

function context(
	accessTier = "orgAdmin",
	organizationId: string | null = "org-1",
) {
	return {
		accessTier,
		authContext: { session: { activeOrganizationId: organizationId } },
	};
}
async function content(page: ReturnType<typeof AbsencePage>) {
	return page.props.children.type();
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.context.mockResolvedValue(context());
	mocks.settings.mockResolvedValue({ employeeSickNoteUpload: true });
	mocks.personnel.mockResolvedValue(true);
	mocks.defaults.mockResolvedValue(undefined);
	mocks.notice.mockResolvedValue([]);
});
describe("combined Absences settings", () => {
	it("keeps admin setup, settings and assignment permissions scoped to the active organization", async () => {
		const page = await content(AbsencePage());
		expect(page.key).toBe("org-1");
		expect(page.props.panels.holidays.props).toMatchObject({
			organizationId: "org-1",
			canManage: true,
		});
		expect(page.props.panels.vacation.props).toMatchObject({
			organizationId: "org-1",
			canManageCategories: true,
			allowedAssignmentTypes: ["team", "employee"],
		});
		expect(
			page.props.panels.vacation.props.absenceSettings.props,
		).toMatchObject({ enabled: true, personnelFilesEnabled: true });
		expect(mocks.defaults).toHaveBeenCalledWith("org-1");
		expect(mocks.notice).toHaveBeenCalledWith({}, { organizationId: "org-1" });
	});
	it("preserves managers' limited assignments without loading or initializing admin settings", async () => {
		mocks.context.mockResolvedValue(context("manager"));
		const page = await content(AbsencePage());
		expect(page.props.panels.holidays.props.canManage).toBe(false);
		expect(page.props.panels.vacation.props).toMatchObject({
			canManageCategories: false,
			allowedAssignmentTypes: ["employee"],
			absenceSettings: null,
			notice: null,
		});
		for (const load of [
			mocks.settings,
			mocks.personnel,
			mocks.defaults,
			mocks.notice,
		])
			expect(load).not.toHaveBeenCalled();
	});
	it.each([null, context("member"), context("orgAdmin", null)])(
		"rejects access without a manager tier and active organization",
		async (routeContext) => {
			mocks.context.mockResolvedValue(routeContext);
			await expect(content(AbsencePage())).rejects.toThrow(
				"redirect:/settings",
			);
			expect(mocks.defaults).not.toHaveBeenCalled();
		},
	);
	it("preserves the old Holidays URL through a tab redirect", async () => {
		mocks.context.mockResolvedValue(context("manager"));
		await expect(content(LegacyHolidayPage())).rejects.toThrow(
			"redirect:/settings/vacation?tab=holidays",
		);
	});
	it("keeps members out of the old Holidays URL", async () => {
		mocks.context.mockResolvedValue(context("member"));
		await expect(content(LegacyHolidayPage())).rejects.toThrow(
			"redirect:/settings",
		);
	});
});
