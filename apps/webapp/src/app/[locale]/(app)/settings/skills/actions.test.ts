import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	/** The employees the scoped manager manages, by manager link. */
	reports: [] as string[],
	employees: new Map<string, { id: string; organizationId: string }>(),
	skills: {
		createSkill: vi.fn(),
		updateSkill: vi.fn(),
		deleteSkill: vi.fn(),
		getOrganizationSkills: vi.fn(),
		assignSkillToEmployee: vi.fn(),
		getSkillById: vi.fn(),
		updateEmployeeSkillExpiry: vi.fn(),
		getSkillExpiryWindow: vi.fn(),
		removeSkillFromEmployee: vi.fn(),
		getEmployeeSkills: vi.fn(),
		setSubareaSkillRequirements: vi.fn(),
		setTemplateSkillRequirements: vi.fn(),
		validateEmployeeForShift: vi.fn(),
		getQualifiedEmployeesForSkills: vi.fn(),
	},
	saveLeadDays: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/scheduling/skill-reminder-store", () => ({
	saveSkillReminderLeadDays: mocks.saveLeadDays,
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { SkillService } = await import("@/lib/effect/services/skill.service");
	const { Effect: E, Layer } = await import("effect");
	const db = {
		query: {
			employee: {
				// The where clause is opaque here; the stub answers by the id the test names.
				findFirst: vi.fn(async () => {
					const target = mocks.employees.get("target");
					return target && target.organizationId === "org-1" ? { id: target.id } : undefined;
				}),
			},
		},
	};
	const skillService = Object.fromEntries(
		Object.entries(mocks.skills).map(([name, fn]) => [
			name,
			(...args: unknown[]) => E.promise(async () => fn(...args)),
		]),
	);
	return runtimeModuleOver(
		Layer.mergeAll(
			organizationActionStubLayer(() => mocks.caller, {
				db,
				query: (name, fn) => {
					if (name === "organizationAction.managedScope") {
						return E.succeed([mocks.reports.map((id) => ({ id })), []]) as never;
					}
					if (name === "employeeLifecycle.findNotOnCurrentRoster") {
						return E.succeed([]) as never;
					}
					return E.promise(fn);
				},
			}),
			Layer.succeed(SkillService, SkillService.of(skillService as never)),
		),
	);
});

const actions = await import("./actions");

const orgAdmin: StubCaller = {
	userId: "admin-user",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "manager-user",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};
const member: StubCaller = {
	userId: "member-user",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};

const refused = { success: false, code: "AuthorizationError" };

function target(id: string, organizationId = "org-1") {
	mocks.employees.set("target", { id, organizationId });
}

beforeEach(() => {
	mocks.caller = orgAdmin;
	mocks.reports = [];
	mocks.employees.clear();
	for (const fn of Object.values(mocks.skills)) fn.mockReset();
	mocks.saveLeadDays.mockReset();
});

describe("skill catalog actions (org admin)", () => {
	it("creates a skill in the session's organization", async () => {
		mocks.skills.createSkill.mockResolvedValue({ id: "skill-1", organizationId: "org-1" });

		const result = await actions.createSkill({
			name: "Forklift",
			category: "equipment",
			requiresExpiry: true,
		});

		expect(result).toMatchObject({ success: true, data: { id: "skill-1" } });
		expect(mocks.skills.createSkill).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Forklift",
				organizationId: "org-1",
				createdBy: "admin-user",
			}),
		);
	});

	it("refuses a scoped manager on every catalog and requirement change", async () => {
		mocks.caller = scopedManager;

		expect(
			await actions.createSkill({ name: "Forklift", category: "equipment", requiresExpiry: false }),
		).toMatchObject(refused);
		expect(
			await actions.updateSkill({ skillId: "skill-1", data: { name: "Crane" } }),
		).toMatchObject(refused);
		expect(await actions.deleteSkill("skill-1")).toMatchObject(refused);
		expect(await actions.saveSkillReminderLeadDays({ leadDays: 7 })).toMatchObject(refused);
		expect(
			await actions.setSubareaSkillRequirements({ subareaId: "subarea-1", requirements: [] }),
		).toMatchObject(refused);
		expect(
			await actions.setTemplateSkillRequirements({ templateId: "template-1", requirements: [] }),
		).toMatchObject(refused);
		expect(mocks.skills.createSkill).not.toHaveBeenCalled();
		expect(mocks.saveLeadDays).not.toHaveBeenCalled();
	});

	it("updates and deletes a skill within the session's organization", async () => {
		mocks.skills.updateSkill.mockResolvedValue({ id: "skill-1" });
		mocks.skills.deleteSkill.mockResolvedValue(undefined);

		expect(
			await actions.updateSkill({ skillId: "skill-1", data: { name: "Crane" } }),
		).toMatchObject({
			success: true,
		});
		expect(await actions.deleteSkill("skill-1")).toEqual({ success: true, data: undefined });
		expect(mocks.skills.updateSkill).toHaveBeenCalledWith("org-1", "skill-1", {
			name: "Crane",
			updatedBy: "admin-user",
		});
		expect(mocks.skills.deleteSkill).toHaveBeenCalledWith("org-1", "skill-1");
	});

	it("rejects an invalid skill before saving", async () => {
		const result = await actions.createSkill({
			name: "",
			category: "equipment",
			requiresExpiry: false,
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.skills.createSkill).not.toHaveBeenCalled();
	});

	it("saves the reminder lead time, refusing one outside 1 to 365 days", async () => {
		mocks.saveLeadDays.mockResolvedValue(undefined);

		expect(await actions.saveSkillReminderLeadDays({ leadDays: "7" })).toEqual({
			success: true,
			data: { leadDays: 7 },
		});
		expect(await actions.saveSkillReminderLeadDays({ leadDays: 0 })).toMatchObject({
			success: false,
			error: "Enter a lead time between 1 and 365 days.",
		});
		expect(mocks.saveLeadDays).toHaveBeenCalledTimes(1);
		expect(mocks.saveLeadDays).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			leadDays: 7,
			actorUserId: "admin-user",
		});
	});

	it("sets subarea and template requirements", async () => {
		const requirements = [{ skillId: "skill-1", isRequired: true }];

		expect(
			await actions.setSubareaSkillRequirements({ subareaId: "subarea-1", requirements }),
		).toMatchObject({ success: true });
		expect(
			await actions.setTemplateSkillRequirements({ templateId: "template-1", requirements }),
		).toMatchObject({ success: true });
		expect(mocks.skills.setSubareaSkillRequirements).toHaveBeenCalledWith({
			organizationId: "org-1",
			targetId: "subarea-1",
			requirements,
			createdBy: "admin-user",
		});
	});
});

describe("skill reads and employee skills (scoped manager)", () => {
	it("refuses an org member", async () => {
		mocks.caller = member;
		target("employee-2");

		expect(await actions.getOrganizationSkills({})).toMatchObject(refused);
		expect(await actions.getSkillExpiryWindow()).toMatchObject(refused);
		expect(await actions.getEmployeeSkills("employee-2")).toMatchObject(refused);
		expect(
			await actions.assignSkillToEmployee({ employeeId: "employee-2", skillId: "skill-1" }),
		).toMatchObject(refused);
		expect(
			await actions.updateEmployeeSkillExpiry({
				employeeId: "employee-2",
				skillId: "skill-1",
				expiresAt: null,
			}),
		).toMatchObject(refused);
		expect(
			await actions.removeSkillFromEmployee({ employeeId: "employee-2", skillId: "skill-1" }),
		).toMatchObject(refused);
	});

	it("lists the session organization's skills for a scoped manager", async () => {
		mocks.caller = scopedManager;
		mocks.skills.getOrganizationSkills.mockResolvedValue([{ id: "skill-1" }]);

		expect(await actions.getOrganizationSkills({ includeInactive: true })).toEqual({
			success: true,
			data: [{ id: "skill-1" }],
		});
		expect(mocks.skills.getOrganizationSkills).toHaveBeenCalledWith("org-1", {
			includeInactive: true,
		});
	});

	it("lets a scoped manager manage the skills of an employee they manage", async () => {
		mocks.caller = scopedManager;
		mocks.reports = ["employee-2"];
		target("employee-2");
		mocks.skills.assignSkillToEmployee.mockResolvedValue({ id: "employee-skill-1" });
		mocks.skills.getSkillById.mockResolvedValue({ id: "skill-1", name: "Forklift" });

		expect(
			await actions.assignSkillToEmployee({ employeeId: "employee-2", skillId: "skill-1" }),
		).toMatchObject({ success: true, data: { id: "employee-skill-1", skill: { id: "skill-1" } } });
		expect(mocks.skills.assignSkillToEmployee).toHaveBeenCalledWith({
			employeeId: "employee-2",
			skillId: "skill-1",
			organizationId: "org-1",
			assignedBy: "manager-user",
		});
	});

	it("refuses a scoped manager for an employee they do not manage", async () => {
		mocks.caller = scopedManager;
		mocks.reports = ["employee-3"];
		target("employee-2");

		expect(await actions.getEmployeeSkills("employee-2")).toMatchObject(refused);
		expect(
			await actions.removeSkillFromEmployee({ employeeId: "employee-2", skillId: "skill-1" }),
		).toMatchObject(refused);
		expect(mocks.skills.getEmployeeSkills).not.toHaveBeenCalled();
		expect(mocks.skills.removeSkillFromEmployee).not.toHaveBeenCalled();
	});

	it("does not find an employee of another organization", async () => {
		target("employee-9", "org-2");

		expect(await actions.getEmployeeSkills("employee-9")).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(mocks.skills.getEmployeeSkills).not.toHaveBeenCalled();
	});
});

describe("shift skill checks (org member)", () => {
	const signedOut = null;

	it("refuses a caller without settings access", async () => {
		mocks.caller = { ...member, membershipRole: null };
		expect(
			await actions.getQualifiedEmployeesForSkills({
				skillIds: ["skill-1"],
				shiftDate: "2026-11-12",
			}),
		).toMatchObject({ success: false });
		mocks.caller = signedOut;
		expect(
			await actions.validateEmployeeForShift({
				employeeId: "employee-2",
				shift: { subareaId: "subarea-1", date: "2026-11-12" },
			}),
		).toMatchObject({ success: false });
	});

	it("checks qualifications in the session's organization for any org member", async () => {
		mocks.caller = member;
		mocks.skills.getQualifiedEmployeesForSkills.mockResolvedValue(["employee-2"]);
		mocks.skills.validateEmployeeForShift.mockResolvedValue({ isQualified: true });

		expect(
			await actions.getQualifiedEmployeesForSkills({
				skillIds: ["skill-1"],
				shiftDate: "2026-11-12",
			}),
		).toEqual({ success: true, data: ["employee-2"] });
		expect(
			await actions.validateEmployeeForShift({
				employeeId: "employee-2",
				shift: { subareaId: "subarea-1", templateId: null, date: "2026-11-12" },
			}),
		).toMatchObject({ success: true });
		expect(mocks.skills.getQualifiedEmployeesForSkills).toHaveBeenCalledWith(
			"org-1",
			["skill-1"],
			"2026-11-12",
		);
		expect(mocks.skills.validateEmployeeForShift).toHaveBeenCalledWith("org-1", "employee-2", {
			subareaId: "subarea-1",
			templateId: null,
			date: "2026-11-12",
		});
	});
});
