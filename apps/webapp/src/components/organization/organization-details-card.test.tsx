/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { removeOrganizationLogoMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
	removeOrganizationLogoMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
	},
}));

vi.mock("@/hooks/use-image-upload", () => ({
	useImageUpload: () => ({
		addFile: vi.fn(),
		isUploading: false,
		previewUrl: null,
		progress: 0,
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	removeOrganizationLogo: removeOrganizationLogoMock,
}));

vi.mock("./edit-organization-dialog", () => ({
	EditOrganizationDialog: () => null,
}));

import { OrganizationDetailsCard } from "./organization-details-card";

const organization = {
	id: "org-1",
	name: "Acme",
	slug: "acme",
	logo: "https://cdn.example.com/org-logos/org-1/logo.webp",
	metadata: null,
};

describe("OrganizationDetailsCard", () => {
	it("lets owners clear the organization logo without deleting storage objects", async () => {
		removeOrganizationLogoMock.mockResolvedValue({ success: true, data: undefined });

		render(
			<OrganizationDetailsCard
				organization={organization as never}
				memberCount={3}
				currentMemberRole="owner"
			/>,
		);

		expect(screen.getByRole("img", { name: "Acme" })).toBeTruthy();

		const removeButton = screen.getByRole("button", { name: "Remove organization logo" });
		const trashIcon = removeButton.querySelector("svg");

		expect(trashIcon?.getAttribute("class")).toContain("text-white");

		fireEvent.click(removeButton);

		await waitFor(() => {
			expect(removeOrganizationLogoMock).toHaveBeenCalledWith("org-1");
		});
		await waitFor(() => {
			expect(screen.queryByRole("img", { name: "Acme" })).toBeNull();
		});
		expect(toastSuccessMock).toHaveBeenCalledWith("Organization logo removed");
	});
});
