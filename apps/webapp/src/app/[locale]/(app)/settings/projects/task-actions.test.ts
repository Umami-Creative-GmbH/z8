import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	canManageProjectTasks: vi.fn(),
	listProjectsWithManageableTasks: vi.fn(),
	findProjectTask: vi.fn(),
	listProjectTasks: vi.fn(),
	insert: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, { db: { insert: mocks.insert } }),
	);
});

vi.mock("@/lib/projects/project-task-permission", () => ({
	canManageProjectTasks: mocks.canManageProjectTasks,
	listProjectsWithManageableTasks: mocks.listProjectsWithManageableTasks,
}));

vi.mock("@/lib/projects/project-tasks", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/projects/project-tasks")>()),
	findProjectTask: mocks.findProjectTask,
	listProjectTasks: mocks.listProjectTasks,
}));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const tasks = await import("./task-actions");

const projectId = "e8720000-0000-4000-8000-000000000020";
const taskId = "e8720000-0000-4000-8000-000000000050";

/** A plain employee: settings access `member`, the level the task actions require. */
const orgMember: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};
const orgAdmin: StubCaller = { ...orgMember, membershipRole: "admin" };

const everyAction = [
	["getProjectTasks", () => tasks.getProjectTasks({ projectId })],
	["createProjectTask", () => tasks.createProjectTask({ projectId, name: "Design" })],
	["updateProjectTask", () => tasks.updateProjectTask({ taskId, name: "Build" })],
	["markProjectTaskDone", () => tasks.markProjectTaskDone(taskId)],
	["reopenProjectTask", () => tasks.reopenProjectTask(taskId)],
	["deleteProjectTask", () => tasks.deleteProjectTask(taskId)],
	["getProjectsWithManageableTasks", () => tasks.getProjectsWithManageableTasks()],
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgMember;
	mocks.canManageProjectTasks.mockResolvedValue(true);
	mocks.listProjectsWithManageableTasks.mockResolvedValue([]);
	mocks.listProjectTasks.mockResolvedValue([]);
	mocks.findProjectTask.mockResolvedValue(null);
});

describe("project task actions", () => {
	describe.each(everyAction)("%s", (_name, run) => {
		it.each([
			["a pending membership", { ...orgMember, membershipRole: null }],
			[
				"a former employee",
				{ ...orgMember, employee: { id: "employee-1", role: "employee" as const, former: true } },
			],
			["a signed-out caller", null],
		])("refuses %s before looking at any project", async (_case, caller) => {
			mocks.caller = caller;

			const result = await run();

			expect(result).toMatchObject({ success: false });
			expect(mocks.canManageProjectTasks).not.toHaveBeenCalled();
			expect(mocks.listProjectsWithManageableTasks).not.toHaveBeenCalled();
			expect(mocks.findProjectTask).not.toHaveBeenCalled();
		});
	});

	it("lists the tasks of a project the caller manages, in the session's organization", async () => {
		const result = await tasks.getProjectTasks({ projectId, state: "open" });

		expect(result).toEqual({ success: true, data: [] });
		expect(mocks.canManageProjectTasks).toHaveBeenCalledWith(
			{ userId: "user-1", organizationId: "org-1", isOrgAdmin: false },
			projectId,
		);
		expect(mocks.listProjectTasks).toHaveBeenCalledWith(
			{ organizationId: "org-1", projectId },
			{ state: "open" },
		);
	});

	it("treats an org admin as managing every project", async () => {
		mocks.caller = orgAdmin;

		await tasks.getProjectsWithManageableTasks();

		expect(mocks.listProjectsWithManageableTasks).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
			isOrgAdmin: true,
		});
	});

	it("refuses a member who does not manage the project", async () => {
		mocks.canManageProjectTasks.mockResolvedValue(false);

		const result = await tasks.createProjectTask({ projectId, name: "Design" });

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("reports a task outside the session's organization as not found", async () => {
		const result = await tasks.markProjectTaskDone(taskId);

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mocks.findProjectTask).toHaveBeenCalledWith({ organizationId: "org-1", taskId });
		expect(mocks.canManageProjectTasks).not.toHaveBeenCalled();
	});

	it("validates the input after authorizing the caller", async () => {
		const result = await tasks.createProjectTask({ projectId, name: 42 } as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.canManageProjectTasks).not.toHaveBeenCalled();
	});
});
