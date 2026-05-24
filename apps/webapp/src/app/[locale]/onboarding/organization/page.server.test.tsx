import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./organization-page-client", () => ({
	default: ({ canCreateOrganizations }: { canCreateOrganizations: boolean }) => (
		<div data-can-create-organizations={String(canCreateOrganizations)} />
	),
}));

async function renderPageWithOrganizationCreationFlag(flag: "true" | "false" | undefined) {
	vi.resetModules();

	if (flag === undefined) {
		delete process.env.DISABLE_ORGANIZATION_CREATION;
	} else {
		process.env.DISABLE_ORGANIZATION_CREATION = flag;
	}

	const { default: OrganizationPage } = await import("./page");

	return OrganizationPage();
}

describe("OrganizationPage", () => {
	afterEach(() => {
		delete process.env.DISABLE_ORGANIZATION_CREATION;
		vi.resetModules();
	});

	it("passes creation availability false when the deployment disables creation", async () => {
		const element = await renderPageWithOrganizationCreationFlag("true");

		expect(element.props.canCreateOrganizations).toBe(false);
	});

	it("passes creation availability true when the deployment allows creation", async () => {
		const element = await renderPageWithOrganizationCreationFlag("false");

		expect(element.props.canCreateOrganizations).toBe(true);
	});

	it("passes creation availability true when the deployment flag is unset", async () => {
		const element = await renderPageWithOrganizationCreationFlag(undefined);

		expect(element.props.canCreateOrganizations).toBe(true);
	});
});
