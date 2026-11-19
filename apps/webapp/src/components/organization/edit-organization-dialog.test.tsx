/* @vitest-environment jsdom */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as authSchema from "@/db/auth-schema";
import { render } from "@/test/render-with-translations";

const mocks = vi.hoisted(() => ({
	updateOrganizationDetails: vi.fn(),
	refresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/organization/actions", () => ({
	updateOrganizationDetails: mocks.updateOrganizationDetails,
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const { EditOrganizationDialog } = await import("./edit-organization-dialog");

type Organization = typeof authSchema.organization.$inferSelect;

const organization = {
	id: "org-1",
	name: "Acme",
	slug: "acme",
	metadata: JSON.stringify({ description: "Makers of things", industry: "manufacturing" }),
	deletedAt: null,
} as Organization;

function nameInput() {
	return screen.getByRole("textbox", { name: /Organization Name/ }) as HTMLInputElement;
}

function slugInput() {
	return screen.getByRole("textbox", { name: "Organization Slug" }) as HTMLInputElement;
}

function descriptionInput() {
	return screen.getByRole("textbox", { name: "Description" }) as HTMLTextAreaElement;
}

describe("EditOrganizationDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(cleanup);

	it("prefills the current organization", () => {
		render(<EditOrganizationDialog organization={organization} open onOpenChange={vi.fn()} />);

		expect(nameInput().value).toBe("Acme");
		expect(slugInput().value).toBe("acme");
		expect(descriptionInput().value).toBe("Makers of things");
	});

	it("sends only the changed fields and keeps other metadata", async () => {
		mocks.updateOrganizationDetails.mockResolvedValue({ success: true, data: undefined });
		const onOpenChange = vi.fn();
		render(<EditOrganizationDialog organization={organization} open onOpenChange={onOpenChange} />);

		fireEvent.change(nameInput(), { target: { value: "Acme Corp" } });
		fireEvent.change(descriptionInput(), { target: { value: "We build" } });
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() => expect(mocks.updateOrganizationDetails).toHaveBeenCalledTimes(1));
		expect(mocks.updateOrganizationDetails).toHaveBeenCalledWith({
			name: "Acme Corp",
			slug: undefined,
			metadata: JSON.stringify({ description: "We build", industry: "manufacturing" }),
		});
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		expect(mocks.refresh).toHaveBeenCalled();
	});

	it("normalizes the slug as it is typed", () => {
		render(<EditOrganizationDialog organization={organization} open onOpenChange={vi.fn()} />);

		fireEvent.change(slugInput(), { target: { value: "Acme Corp_2" } });

		expect(slugInput().value).toBe("acmecorp2");
	});

	it("blocks a name shorter than the server accepts", async () => {
		render(<EditOrganizationDialog organization={organization} open onOpenChange={vi.fn()} />);

		fireEvent.change(nameInput(), { target: { value: "A" } });
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		expect(await screen.findByText("Name must be at least 2 characters")).toBeTruthy();
		expect(mocks.updateOrganizationDetails).not.toHaveBeenCalled();
	});

	it("saves other fields when a stored name is shorter than the minimum, as the server only checks sent fields", async () => {
		mocks.updateOrganizationDetails.mockResolvedValue({ success: true, data: undefined });
		const legacy = { ...organization, name: "A" } as Organization;
		render(<EditOrganizationDialog organization={legacy} open onOpenChange={vi.fn()} />);

		fireEvent.change(descriptionInput(), { target: { value: "We build" } });
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() => expect(mocks.updateOrganizationDetails).toHaveBeenCalledTimes(1));
		expect(mocks.updateOrganizationDetails).toHaveBeenCalledWith(
			expect.objectContaining({ name: undefined, slug: undefined }),
		);
	});

	it("blocks a changed slug shorter than the server accepts", async () => {
		render(<EditOrganizationDialog organization={organization} open onOpenChange={vi.fn()} />);

		fireEvent.change(slugInput(), { target: { value: "a" } });
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		expect(await screen.findByText("Slug must be at least 2 characters")).toBeTruthy();
		expect(mocks.updateOrganizationDetails).not.toHaveBeenCalled();
	});

	it("keeps the entered values when the update fails", async () => {
		mocks.updateOrganizationDetails.mockResolvedValue({
			success: false,
			error: "Slug is already taken",
		});
		const onOpenChange = vi.fn();
		render(<EditOrganizationDialog organization={organization} open onOpenChange={onOpenChange} />);

		fireEvent.change(slugInput(), { target: { value: "taken" } });
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Slug is already taken"));
		expect(slugInput().value).toBe("taken");
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("starts each opening from the current organization", async () => {
		const { rerender } = render(
			<EditOrganizationDialog organization={organization} open onOpenChange={vi.fn()} />,
		);

		fireEvent.change(nameInput(), { target: { value: "Unsaved draft" } });
		rerender(
			<EditOrganizationDialog organization={organization} open={false} onOpenChange={vi.fn()} />,
		);
		const renamed = { ...organization, name: "Acme Holdings" } as Organization;
		rerender(<EditOrganizationDialog organization={renamed} open onOpenChange={vi.fn()} />);

		await waitFor(() => expect(nameInput().value).toBe("Acme Holdings"));
	});
});
