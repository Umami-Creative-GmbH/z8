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
	getCurrentSettingsAccess: mocks.context,
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

import AbsencePage from "./page";

function caller(
	settingsAccess: "member" | "scopedManager" | "orgAdmin" | "owner" | null = "orgAdmin",
	organizationId = "org-1",
) {
	return {
		userId: "user-1",
		organizationId,
		settingsAccess,
		membershipRole: settingsAccess ? "admin" : null,
		employee: null,
	};
}
async function content(page: ReturnType<typeof AbsencePage>) {
	return page.props.children.type();
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.context.mockResolvedValue(caller());
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
		expect(page.props.panels.vacation.props.absenceSettings.props).toMatchObject({
			enabled: true,
			personnelFilesEnabled: true,
		});
		expect(mocks.defaults).toHaveBeenCalledWith("org-1");
		expect(mocks.notice).toHaveBeenCalledWith({}, { organizationId: "org-1" });
	});
	it("preserves managers' limited assignments without loading or initializing admin settings", async () => {
		mocks.context.mockResolvedValue(caller("scopedManager"));
		const page = await content(AbsencePage());
		expect(page.props.panels.holidays.props.canManage).toBe(false);
		expect(page.props.panels.vacation.props).toMatchObject({
			canManageCategories: false,
			allowedAssignmentTypes: ["employee"],
			absenceSettings: null,
			notice: null,
		});
		for (const load of [mocks.settings, mocks.personnel, mocks.defaults, mocks.notice])
			expect(load).not.toHaveBeenCalled();
	});
	it.each([null, caller("member"), caller(null)])(
		"rejects access without scoped-manager settings access and active organization",
		async (routeContext) => {
			mocks.context.mockResolvedValue(routeContext);
			await expect(content(AbsencePage())).rejects.toThrow("redirect:/settings");
			expect(mocks.defaults).not.toHaveBeenCalled();
		},
	);
});
