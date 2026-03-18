/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getCurrentEmployeeMock,
	refreshMock,
	toastErrorMock,
	toastSuccessMock,
	updateProfileDetailsMock,
	updateProfileImageMock,
} = vi.hoisted(() => ({
	getCurrentEmployeeMock: vi.fn(),
	refreshMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	updateProfileDetailsMock: vi.fn(),
	updateProfileImageMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: toastSuccessMock,
		error: toastErrorMock,
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: {},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/app/[locale]/(app)/approvals/actions", () => ({
	getCurrentEmployee: getCurrentEmployeeMock,
}));

vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({
	updateProfileDetails: updateProfileDetailsMock,
	updateProfileImage: updateProfileImageMock,
}));

vi.mock("@/hooks/use-image-upload", () => ({
	useImageUpload: () => ({
		addFile: vi.fn(),
		isUploading: false,
		previewUrl: null,
		progress: 0,
	}),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("@/components/ui/popover", () => ({
	Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/calendar", () => ({
	Calendar: () => <div>calendar</div>,
}));

import { ProfileForm } from "./profile-form";

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
}

function renderProfileForm(user?: {
	id?: string;
	name?: string;
	email?: string;
	image?: string | null;
	firstName?: string | null;
	lastName?: string | null;
}) {
	const queryClient = createQueryClient();

	return render(
		<QueryClientProvider client={queryClient}>
			<ProfileForm
				user={{
					id: user?.id ?? "user-1",
					name: user?.name ?? "Existing Name",
					email: user?.email ?? "user@example.com",
					image: user?.image ?? "/avatar.png",
					firstName: user?.firstName ?? "Auth",
					lastName: user?.lastName ?? "Fallback",
				}}
			/>
		</QueryClientProvider>,
	);
}

describe("ProfileForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getCurrentEmployeeMock.mockResolvedValue({
			firstName: "Employee",
			lastName: "Record",
			gender: "female",
			birthday: "2020-01-02T00:00:00.000Z",
		});
		updateProfileDetailsMock.mockResolvedValue({ success: true, data: undefined });
		updateProfileImageMock.mockResolvedValue({ success: true, data: undefined });
	});

	it("renders first and last name fields without the old Name input", async () => {
		renderProfileForm();

		expect(await screen.findByLabelText("First Name")).toBeTruthy();
		expect(screen.getByLabelText("Last Name")).toBeTruthy();
		expect(screen.queryByLabelText("Name")).toBeNull();
	});

	it("submits structured names through updateProfileDetails", async () => {
		renderProfileForm();
		expect(await screen.findByDisplayValue("Employee")).toBeTruthy();

		fireEvent.change(screen.getByLabelText("First Name"), {
			target: { value: "Ada" },
		});
		fireEvent.change(screen.getByLabelText("Last Name"), {
			target: { value: "Lovelace" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		await waitFor(() => {
			expect(updateProfileDetailsMock).toHaveBeenCalledWith({
				firstName: "Ada",
				lastName: "Lovelace",
				gender: "female",
				birthday: new Date("2020-01-02T00:00:00.000Z"),
				image: "/avatar.png",
			});
		});
		expect(updateProfileImageMock).not.toHaveBeenCalled();
	});

	it("falls back to auth-level first and last names when no employee record exists", async () => {
		getCurrentEmployeeMock.mockResolvedValue(null);

		renderProfileForm({
			firstName: "Auth",
			lastName: "User",
			name: "Stale Display Name",
		});

		const firstNameInput = await screen.findByLabelText("First Name");
		const lastNameInput = screen.getByLabelText("Last Name");

		expect((firstNameInput as HTMLInputElement).value).toBe("Auth");
		expect((lastNameInput as HTMLInputElement).value).toBe("User");

		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		await waitFor(() => {
			expect(updateProfileDetailsMock).toHaveBeenCalledWith({
				firstName: "Auth",
				lastName: "User",
				gender: null,
				birthday: null,
				image: "/avatar.png",
			});
		});
	});

	it("shows field errors and focuses the first invalid field when both name fields are blank on submit", async () => {
		getCurrentEmployeeMock.mockResolvedValue(null);

		renderProfileForm({
			firstName: "Ada",
			lastName: "Lovelace",
		});

		const firstNameInput = await screen.findByLabelText("First Name");
		const lastNameInput = screen.getByLabelText("Last Name");

		fireEvent.change(firstNameInput, {
			target: { value: "   " },
		});
		fireEvent.change(lastNameInput, {
			target: { value: "   " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		await waitFor(() => {
			expect(document.activeElement).toBe(firstNameInput);
			expect(screen.getAllByText("Enter a first or last name")).toHaveLength(2);
			expect(firstNameInput.getAttribute("aria-invalid")).toBe("true");
			expect(lastNameInput.getAttribute("aria-invalid")).toBe("true");
		});

		expect(updateProfileDetailsMock).not.toHaveBeenCalled();
	});

	it("uses example-style placeholders and the saving ellipsis in the profile form", async () => {
		let resolveUpdate: ((value: { success: true; data: undefined }) => void) | undefined;
		updateProfileDetailsMock.mockImplementation(
			() =>
				new Promise<{ success: true; data: undefined }>((resolve) => {
					resolveUpdate = resolve;
				}),
		);

		renderProfileForm();

		const firstNameInput = await screen.findByLabelText("First Name");
		const lastNameInput = screen.getByLabelText("Last Name");

		expect(firstNameInput.getAttribute("placeholder")).toBe("Ada…");
		expect(lastNameInput.getAttribute("placeholder")).toBe("Lovelace…");

		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		expect(await screen.findByRole("button", { name: "Saving…" })).toBeTruthy();

		resolveUpdate?.({ success: true, data: undefined });
		await waitFor(() => {
			expect(toastSuccessMock).toHaveBeenCalled();
		});
	});
});
