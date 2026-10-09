import { describe, expect, it } from "vitest";
import { buildProjectMappings } from "./project-mappings";

const z8Projects = [
	{ id: "p-website", name: "Website Relaunch", customerName: "Acme", isActive: true },
	{ id: "p-internal", name: "Internal", customerName: null, isActive: true },
];

describe("buildProjectMappings (#907)", () => {
	it("prefers a saved mapping, then an exact name match, else leaves the project unmapped", () => {
		expect(
			buildProjectMappings(
				[
					{ id: 1, name: "Relaunch 2026", customerName: "Acme GmbH", active: true },
					{ id: 2, name: " website relaunch ", customerName: "Acme GmbH", active: true },
					{ id: 3, name: "Support", customerName: null, active: false },
				],
				z8Projects,
				[{ clockodoProjectId: 1, projectId: "p-internal" }],
			),
		).toEqual([
			{
				clockodoProjectId: 1,
				clockodoProjectName: "Relaunch 2026",
				clockodoCustomerName: "Acme GmbH",
				projectId: "p-internal",
				source: "saved",
			},
			{
				clockodoProjectId: 2,
				clockodoProjectName: " website relaunch ",
				clockodoCustomerName: "Acme GmbH",
				projectId: "p-website",
				source: "name",
			},
			{
				clockodoProjectId: 3,
				clockodoProjectName: "Support",
				clockodoCustomerName: null,
				projectId: null,
				source: null,
			},
		]);
	});

	it("ignores a saved mapping whose Z8 project no longer exists", () => {
		expect(
			buildProjectMappings(
				[{ id: 1, name: "Gone", customerName: null, active: true }],
				z8Projects,
				[{ clockodoProjectId: 1, projectId: "p-deleted" }],
			),
		).toEqual([expect.objectContaining({ projectId: null, source: null })]);
	});
});
