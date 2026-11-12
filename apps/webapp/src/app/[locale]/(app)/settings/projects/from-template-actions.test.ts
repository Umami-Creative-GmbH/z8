import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	getProjectTemplate: vi.fn(),
	listProjectTemplates: vi.fn(),
	projectAsTemplateInput: vi.fn(),
	createProjectFromTemplateRows: vi.fn(),
	transaction: vi.fn(),
	findFirst: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { transaction: mocks.transaction, query: { project: { findFirst: mocks.findFirst } } },
		}),
	);
});

vi.mock("@/lib/projects/project-templates", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/projects/project-templates")>()),
	getProjectTemplate: mocks.getProjectTemplate,
	listProjectTemplates: mocks.listProjectTemplates,
}));

vi.mock("@/lib/projects/project-from-template", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/projects/project-from-template")>()),
	projectAsTemplateInput: mocks.projectAsTemplateInput,
	createProjectFromTemplateRows: mocks.createProjectFromTemplateRows,
}));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const fromTemplate = await import("./from-template-actions");

const templateId = "e8800000-0000-4000-8000-000000000030";
const projectId = "e8800000-0000-4000-8000-000000000020";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};

/** Each action with a caller one level below the settings access it requires. */
const everyAction = [
	["getProjectTemplateChoices", orgMember, () => fromTemplate.getProjectTemplateChoices()],
	[
		"getProjectTemplatePreview",
		orgMember,
		() => fromTemplate.getProjectTemplatePreview(templateId),
	],
	[
		"createProjectFromTemplate",
		orgMember,
		() => fromTemplate.createProjectFromTemplate({ templateId, name: "Relaunch" }),
	],
	["saveProjectAsTemplate", scopedManager, () => fromTemplate.saveProjectAsTemplate({ projectId })],
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.getProjectTemplate.mockResolvedValue(null);
	mocks.listProjectTemplates.mockResolvedValue([]);
	mocks.projectAsTemplateInput.mockResolvedValue(null);
	mocks.findFirst.mockResolvedValue(undefined);
	mocks.transaction.mockImplementation((work: (tx: unknown) => unknown) => work({}));
});

describe("project from template actions", () => {
	it.each(everyAction)("%s refuses a caller one level below", async (_name, caller, run) => {
		mocks.caller = caller;

		const result = await run();

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.getProjectTemplate).not.toHaveBeenCalled();
		expect(mocks.listProjectTemplates).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("offers a scoped manager the templates of the session's organization", async () => {
		mocks.caller = scopedManager;

		const result = await fromTemplate.getProjectTemplateChoices();

		expect(result).toEqual({ success: true, data: [] });
		expect(mocks.listProjectTemplates).toHaveBeenCalledWith({ organizationId: "org-1" });
	});

	it("previews without managers for a scoped manager and with them for an org admin", async () => {
		mocks.getProjectTemplate.mockResolvedValue({ id: templateId, name: "Relaunch" });

		mocks.caller = scopedManager;
		const scoped = await fromTemplate.getProjectTemplatePreview(templateId);
		mocks.caller = orgAdmin;
		const admin = await fromTemplate.getProjectTemplatePreview(templateId);

		expect(scoped).toMatchObject({ success: true, data: { managersCopied: false } });
		expect(admin).toMatchObject({ success: true, data: { managersCopied: true } });
		expect(mocks.getProjectTemplate).toHaveBeenCalledWith({ organizationId: "org-1", templateId });
	});

	it("reports a template or project outside the session's organization as not found", async () => {
		const preview = await fromTemplate.getProjectTemplatePreview(templateId);
		const saved = await fromTemplate.saveProjectAsTemplate({ projectId, name: "Blueprint" });

		expect(preview).toMatchObject({ success: false, code: "NotFoundError" });
		expect(saved).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mocks.projectAsTemplateInput).toHaveBeenCalledWith(
			{},
			{ organizationId: "org-1", projectId },
		);
	});

	it("validates the input after authorizing the caller", async () => {
		const result = await fromTemplate.createProjectFromTemplate({ templateId, name: 7 } as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.createProjectFromTemplateRows).not.toHaveBeenCalled();
	});
});
