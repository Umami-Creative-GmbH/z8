/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
	getCurrentEmployeeMock,
	refreshMock,
	tMock,
	toastErrorMock,
	toastSuccessMock,
	updateProfileDetailsMock,
	updateProfileImageMock,
} = vi.hoisted(() => ({
	getCurrentEmployeeMock: vi.fn(),
	refreshMock: vi.fn(),
	tMock: vi.fn((_key: string, defaultValue?: string) => defaultValue ?? _key),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	updateProfileDetailsMock: vi.fn(),
	updateProfileImageMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: tMock,
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
	UserAvatar: ({ gender, name }: { gender?: string | null; name: string }) => (
		<div data-avatar-gender={gender ?? ""}>{name}</div>
	),
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

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

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
	helpImproveProduct?: boolean;
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
					helpImproveProduct: user?.helpImproveProduct ?? true,
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
			pronouns: "she/her",
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

	it("uses settings profile static literal keys for visible copy", async () => {
		getCurrentEmployeeMock.mockResolvedValue(null);
		renderProfileForm();

		expect(await screen.findByText("Profile Information")).toBeTruthy();

		expect(tMock).toHaveBeenCalledWith("settings.profile.information", "Profile Information");
		expect(tMock).toHaveBeenCalledWith("settings.profile.firstName", "First Name");
		expect(tMock).toHaveBeenCalledWith("settings.profile.gender.male", "Male");
		expect(tMock).toHaveBeenCalledWith(
			"settings.profile.birthday.placeholder",
			"Pick your birthday",
		);
	});

	it("initializes auth names and submits employee personal fields through updateProfileDetails", async () => {
		renderProfileForm();

		const firstNameInput = await screen.findByLabelText("First Name");
		const lastNameInput = screen.getByLabelText("Last Name");

		expect((firstNameInput as HTMLInputElement).value).toBe("Auth");
		expect((lastNameInput as HTMLInputElement).value).toBe("Fallback");

		fireEvent.change(firstNameInput, {
			target: { value: "Ada" },
		});
		fireEvent.change(lastNameInput, {
			target: { value: "Lovelace" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		await waitFor(() => {
			expect(updateProfileDetailsMock).toHaveBeenCalledWith({
				firstName: "Ada",
				lastName: "Lovelace",
				gender: "female",
				pronouns: "she/her",
				birthday: new Date("2020-01-02T00:00:00.000Z"),
				image: "/avatar.png",
				helpImproveProduct: true,
			});
		});
		expect(updateProfileImageMock).not.toHaveBeenCalled();
	});

	it("passes selected gender to the profile picture preview", async () => {
		renderProfileForm();

		expect((await screen.findByText("Auth Fallback")).getAttribute("data-avatar-gender")).toBe(
			"female",
		);
	});

	it("loads a disabled product improvement preference", async () => {
		renderProfileForm({ helpImproveProduct: false });

		const helpImproveProduct = await screen.findByRole("switch", {
			name: "Help us improve this app",
		});

		expect(helpImproveProduct.getAttribute("aria-checked")).toBe("false");
		expect(
			screen.getByText("Share usage insights so we can make Z8 more reliable and useful."),
		).toBeTruthy();
	});

	it("submits the enabled product improvement preference", async () => {
		renderProfileForm({ helpImproveProduct: false });

		const helpImproveProduct = await screen.findByRole("switch", {
			name: "Help us improve this app",
		});
		fireEvent.click(helpImproveProduct);
		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		await waitFor(() => {
			expect(updateProfileDetailsMock).toHaveBeenCalledWith(
				expect.objectContaining({ helpImproveProduct: true }),
			);
		});
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
				pronouns: null,
				birthday: null,
				image: "/avatar.png",
				helpImproveProduct: true,
			});
		});
	});

	it("submits custom pronouns through updateProfileDetails", async () => {
		renderProfileForm();

		const pronounsInput = await screen.findByLabelText("Custom pronouns");
		fireEvent.change(pronounsInput, { target: { value: "xe/xem" } });
		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		await waitFor(() => {
			expect(updateProfileDetailsMock).toHaveBeenCalledWith(
				expect.objectContaining({ pronouns: "xe/xem" }),
			);
		});
	});

	it("shows an inline error when custom pronouns are longer than 50 characters", async () => {
		renderProfileForm();

		const pronounsInput = await screen.findByLabelText("Custom pronouns");
		fireEvent.change(pronounsInput, { target: { value: "x".repeat(51) } });
		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		expect(await screen.findByText("Pronouns must be 50 characters or less")).toBeTruthy();
		expect(updateProfileDetailsMock).not.toHaveBeenCalled();
	});

	it("focuses custom pronouns when it is the first invalid profile field", async () => {
		renderProfileForm();

		const pronounsInput = await screen.findByLabelText("Custom pronouns");
		fireEvent.change(pronounsInput, { target: { value: "x".repeat(51) } });
		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		await waitFor(() => {
			expect(document.activeElement).toBe(pronounsInput);
		});
		expect(pronounsInput.getAttribute("name")).toBe("pronouns");
		expect(updateProfileDetailsMock).not.toHaveBeenCalled();
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
		expect(screen.getByLabelText("Custom pronouns").getAttribute("placeholder")).toBe(
			"e.g., xe/xem…",
		);

		fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

		expect(await screen.findByRole("button", { name: "Saving…" })).toBeTruthy();

		resolveUpdate?.({ success: true, data: undefined });
		await waitFor(() => {
			expect(toastSuccessMock).toHaveBeenCalled();
		});
	});

	it("uses compact icon-only profile picture actions beside the name fields", async () => {
		renderProfileForm();

		await screen.findByRole("button", { name: "Remove Picture" });

		expect(screen.queryByText("Profile Picture")).toBeNull();
		expect(screen.queryByText("JPG, PNG or WebP. Max 5MB. Recommended 400x400px")).toBeNull();
		expect(screen.getAllByRole("button", { name: "Change Picture" })).toHaveLength(1);

		const removePictureButton = screen.getByRole("button", { name: "Remove Picture" });
		expect(removePictureButton.className).toContain("absolute");
		expect(removePictureButton.className).toContain("top-0");
		expect(removePictureButton.className).toContain("right-0");
		expect(removePictureButton.textContent).toBe("");
	});
});
