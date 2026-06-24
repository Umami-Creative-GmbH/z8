/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshMock, toastErrorMock, toastSuccessMock, updateLanguageMock } = vi.hoisted(() => ({
	refreshMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	updateLanguageMock: vi.fn(),
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

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	updateOrganizationDefaultNotificationLanguage: updateLanguageMock,
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({
		children,
		value,
		onValueChange,
		disabled,
	}: {
		children: ReactNode;
		value: string;
		onValueChange: (value: string) => void;
		disabled?: boolean;
	}) => (
		<select
			aria-label="Default notification language"
			disabled={disabled}
			value={value}
			onChange={(event) => onValueChange(event.currentTarget.value)}
		>
			{children}
		</select>
	),
	SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectItem: ({ children, value }: { children: ReactNode; value: string }) => {
		const childArray = Array.isArray(children) ? children : [children];
		const onlyChild = childArray.length === 1 ? childArray[0] : null;
		const isGroupedContent =
			typeof onlyChild === "object" &&
			onlyChild !== null &&
			"props" in onlyChild &&
			typeof onlyChild.props === "object" &&
			onlyChild.props !== null &&
			"className" in onlyChild.props &&
			typeof onlyChild.props.className === "string" &&
			onlyChild.props.className.includes("flex") &&
			onlyChild.props.className.includes("items-center");

		return (
			<option data-grouped-content={isGroupedContent ? "true" : "false"} value={value}>
				{value}
			</option>
		);
	},
	SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
	SelectValue: () => null,
}));

import { OrganizationLanguageCard } from "./organization-language-card";

describe("OrganizationLanguageCard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("lets admins update the default notification language", async () => {
		updateLanguageMock.mockResolvedValue({ success: true, data: undefined });

		render(
			<OrganizationLanguageCard
				organizationId="org-1"
				defaultLanguage="en"
				currentMemberRole="admin"
			/>,
		);

		fireEvent.change(screen.getByLabelText("Default notification language"), {
			target: { value: "de" },
		});

		await waitFor(() => {
			expect(updateLanguageMock).toHaveBeenCalledWith("org-1", "de");
		});
		expect(toastSuccessMock).toHaveBeenCalledWith("Organization notification language updated");
		expect(refreshMock).toHaveBeenCalledOnce();
	});

	it("disables the language control for members", () => {
		render(
			<OrganizationLanguageCard
				organizationId="org-1"
				defaultLanguage="en"
				currentMemberRole="member"
			/>,
		);

		expect(screen.getByLabelText("Default notification language")).toHaveProperty("disabled", true);
		expect(
			screen.getByText(
				"Only organization admins and owners can change the notification language setting.",
			),
		).toBeTruthy();
	});

	it("disables the language control while saving", async () => {
		let resolveUpdate: (value: { success: true; data: undefined }) => void = () => undefined;
		updateLanguageMock.mockReturnValue(
			new Promise((resolve) => {
				resolveUpdate = resolve;
			}),
		);

		render(
			<OrganizationLanguageCard
				organizationId="org-1"
				defaultLanguage="en"
				currentMemberRole="admin"
			/>,
		);

		const languageSelect = screen.getByLabelText("Default notification language");

		fireEvent.change(languageSelect, { target: { value: "de" } });

		await waitFor(() => {
			expect(languageSelect).toHaveProperty("disabled", true);
		});
		expect(updateLanguageMock).toHaveBeenCalledOnce();

		resolveUpdate({ success: true, data: undefined });

		await waitFor(() => {
			expect(languageSelect).toHaveProperty("disabled", false);
		});
	});

	it("does not update when the selected language is already current", () => {
		render(
			<OrganizationLanguageCard
				organizationId="org-1"
				defaultLanguage="en"
				currentMemberRole="admin"
			/>,
		);

		fireEvent.change(screen.getByLabelText("Default notification language"), {
			target: { value: "en" },
		});

		expect(updateLanguageMock).not.toHaveBeenCalled();
	});

	it("keeps flag and language label grouped in each select option", () => {
		render(
			<OrganizationLanguageCard
				organizationId="org-1"
				defaultLanguage="en"
				currentMemberRole="admin"
			/>,
		);

		for (const option of screen.getAllByRole("option")) {
			expect(option.getAttribute("data-grouped-content")).toBe("true");
		}
	});

	it("does not submit a second update while the first save is in flight", async () => {
		let resolveUpdate: (value: { success: true; data: undefined }) => void = () => undefined;
		updateLanguageMock.mockReturnValue(
			new Promise((resolve) => {
				resolveUpdate = resolve;
			}),
		);

		render(
			<OrganizationLanguageCard
				organizationId="org-1"
				defaultLanguage="en"
				currentMemberRole="admin"
			/>,
		);

		const languageSelect = screen.getByLabelText("Default notification language");

		fireEvent.change(languageSelect, { target: { value: "de" } });

		await waitFor(() => {
			expect(updateLanguageMock).toHaveBeenCalledOnce();
		});

		fireEvent.change(languageSelect, { target: { value: "fr" } });

		expect(updateLanguageMock).toHaveBeenCalledOnce();

		await act(async () => {
			resolveUpdate({ success: true, data: undefined });
		});
	});
});
