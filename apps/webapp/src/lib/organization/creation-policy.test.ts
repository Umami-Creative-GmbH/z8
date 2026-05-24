import { afterEach, describe, expect, it, vi } from "vitest";
import {
	canCreateOrganizationsForDeployment,
	isOrganizationCreationDisabled,
} from "./creation-policy";

describe("organization creation policy", () => {
	afterEach(() => {
		vi.resetModules();
		vi.doUnmock("@/env");
	});

	it("allows creation when the deployment flag is false", () => {
		expect(isOrganizationCreationDisabled()).toBe(false);
		expect(isOrganizationCreationDisabled("false")).toBe(false);
		expect(canCreateOrganizationsForDeployment(true, "false")).toBe(true);
		expect(canCreateOrganizationsForDeployment(false, "false")).toBe(false);
	});

	it("blocks creation for every user when the deployment flag is true", () => {
		expect(isOrganizationCreationDisabled("true")).toBe(true);
		expect(canCreateOrganizationsForDeployment(true, "true")).toBe(false);
		expect(canCreateOrganizationsForDeployment(false, "true")).toBe(false);
	});

	it("reads the deployment flag from server env in the server wrapper", async () => {
		vi.doMock("@/env", () => ({
			env: { DISABLE_ORGANIZATION_CREATION: "true" },
		}));

		const {
			canCreateOrganizationsForDeployment: canCreateWithServerEnv,
			isOrganizationCreationDisabled: isDisabledWithServerEnv,
		} = await import("./creation-policy.server");

		expect(isDisabledWithServerEnv()).toBe(true);
		expect(canCreateWithServerEnv(true)).toBe(false);
	});
});
