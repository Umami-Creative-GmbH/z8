import { describe, expect, it } from "vitest";
import {
	BillableWorkRefusedError,
	type ProjectBillability,
	projectAllocationAgrees,
	resolveWorkBillability,
} from "./work-billability";

const customerProject = (billableDefault: boolean): ProjectBillability => ({
	projectId: "project-1",
	customerId: "customer-1",
	billableDefault,
});
const internalProject: ProjectBillability = {
	projectId: "project-2",
	customerId: null,
	billableDefault: false,
};

describe("projectAllocationAgrees", () => {
	const allocation = (isBillable: boolean, projectId = "project-1") => ({
		allocationKind: "project",
		projectId,
		weightPercent: 100,
		isBillable,
	});

	it("agrees when the one project allocation carries the period's billability", () => {
		expect(
			projectAllocationAgrees({ projectId: "project-1", isBillable: true }, [allocation(true)]),
		).toBe(true);
		expect(
			projectAllocationAgrees({ projectId: "project-1", isBillable: false }, [allocation(false)]),
		).toBe(true);
	});

	it("disagrees when only billability differs", () => {
		expect(
			projectAllocationAgrees({ projectId: "project-1", isBillable: true }, [allocation(false)]),
		).toBe(false);
		expect(
			projectAllocationAgrees({ projectId: "project-1", isBillable: false }, [allocation(true)]),
		).toBe(false);
	});

	it("agrees on work without a project only without project allocations", () => {
		expect(projectAllocationAgrees({ projectId: null, isBillable: false }, [])).toBe(true);
		expect(
			projectAllocationAgrees({ projectId: null, isBillable: false }, [allocation(false)]),
		).toBe(false);
	});
});

describe("resolveWorkBillability", () => {
	it("records new work on a project with its billable default", () => {
		expect(
			resolveWorkBillability({
				project: customerProject(true),
				projectChosen: true,
				current: false,
			}),
		).toBe(true);
		expect(
			resolveWorkBillability({
				project: customerProject(false),
				projectChosen: true,
				current: true,
			}),
		).toBe(false);
	});

	it("never records work without a project as billable", () => {
		expect(resolveWorkBillability({ project: null, projectChosen: true, current: true })).toBe(
			false,
		);
		expect(resolveWorkBillability({ project: null, projectChosen: false, current: true })).toBe(
			false,
		);
	});

	it("gives a project without a customer no billable default", () => {
		expect(
			resolveWorkBillability({
				project: { ...internalProject, billableDefault: true },
				projectChosen: true,
				current: false,
			}),
		).toBe(false);
	});

	it("preserves the source's billability while the project stays", () => {
		expect(
			resolveWorkBillability({
				project: customerProject(false),
				projectChosen: false,
				current: true,
			}),
		).toBe(true);
		expect(
			resolveWorkBillability({
				project: customerProject(true),
				projectChosen: false,
				current: false,
			}),
		).toBe(false);
	});

	it("lets an explicit request override the default in either direction", () => {
		expect(
			resolveWorkBillability({
				project: customerProject(true),
				projectChosen: true,
				current: false,
				requested: false,
			}),
		).toBe(false);
		expect(
			resolveWorkBillability({
				project: customerProject(false),
				projectChosen: false,
				current: false,
				requested: true,
			}),
		).toBe(true);
	});

	it("refuses billable work without a project or without a customer", () => {
		expect(() =>
			resolveWorkBillability({
				project: null,
				projectChosen: true,
				current: false,
				requested: true,
			}),
		).toThrow(expect.objectContaining({ reason: "no_project" }));
		expect(() =>
			resolveWorkBillability({
				project: internalProject,
				projectChosen: true,
				current: false,
				requested: true,
			}),
		).toThrow(BillableWorkRefusedError);
		expect(() =>
			resolveWorkBillability({
				project: internalProject,
				projectChosen: true,
				current: false,
				requested: true,
			}),
		).toThrow(expect.objectContaining({ reason: "no_customer" }));
	});

	it("accepts an explicit non-billable request without a project", () => {
		expect(
			resolveWorkBillability({
				project: null,
				projectChosen: true,
				current: false,
				requested: false,
			}),
		).toBe(false);
	});
});
