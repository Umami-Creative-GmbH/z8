import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	getProjectTemplate: vi.fn(),
	listProjectTemplates: vi.fn(),
	writeProjectTemplate: vi.fn(),
	deleteProjectTemplateRow: vi.fn(),
	transaction: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, { db: { transaction: mocks.transaction } }),
	);
});

vi.mock("@/lib/projects/project-templates", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/projects/project-templates")>()),
	getProjectTemplate: mocks.getProjectTemplate,
	listProjectTemplates: mocks.listProjectTemplates,
	writeProjectTemplate: mocks.writeProjectTemplate,
	deleteProjectTemplateRow: mocks.deleteProjectTemplateRow,
}));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const templates = await import("./template-actions");

const templateId = "e8780000-0000-4000-8000-000000000030";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
/** One level below the `orgAdmin` the template actions require. */
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

const everyAction = [
	["getProjectTemplates", () => templates.getProjectTemplates()],
	["getProjectTemplateDetails", () => templates.getProjectTemplateDetails(templateId)],
	["createProjectTemplate", () => templates.createProjectTemplate({ name: "Relaunch" })],
	[
		"updateProjectTemplate",
		() => templates.updateProjectTemplate({ templateId, name: "Relaunch" }),
	],
	["deleteProjectTemplate", () => templates.deleteProjectTemplate(templateId)],
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.getProjectTemplate.mockResolvedValue(null);
	mocks.listProjectTemplates.mockResolvedValue([]);
});

describe("project template actions", () => {
	describe.each(everyAction)("%s", (_name, run) => {
		it.each([
			["a scoped manager", scopedManager],
			[
				"a former employee",
				{ ...orgAdmin, employee: { id: "employee-1", role: "admin" as const, former: true } },
			],
		])("refuses %s before touching any template", async (_case, caller) => {
			mocks.caller = caller;

			const result = await run();

			expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
			expect(mocks.getProjectTemplate).not.toHaveBeenCalled();
			expect(mocks.listProjectTemplates).not.toHaveBeenCalled();
			expect(mocks.transaction).not.toHaveBeenCalled();
			expect(mocks.deleteProjectTemplateRow).not.toHaveBeenCalled();
		});
	});

	it("lists the templates of the session's organization", async () => {
		const result = await templates.getProjectTemplates();

		expect(result).toEqual({ success: true, data: [] });
		expect(mocks.listProjectTemplates).toHaveBeenCalledWith({ organizationId: "org-1" });
	});

	it("reports a template outside the session's organization as not found", async () => {
		const results = await Promise.all([
			templates.getProjectTemplateDetails(templateId),
			templates.updateProjectTemplate({ templateId, name: "Renamed" }),
			templates.deleteProjectTemplate(templateId),
		]);

		for (const result of results) {
			expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		}
		expect(mocks.getProjectTemplate).toHaveBeenCalledWith({ organizationId: "org-1", templateId });
		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(mocks.deleteProjectTemplateRow).not.toHaveBeenCalled();
	});

	it("validates the input after authorizing the caller", async () => {
		const result = await templates.createProjectTemplate({
			name: "Relaunch",
			tasks: "Design",
		} as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.transaction).not.toHaveBeenCalled();
	});
});
