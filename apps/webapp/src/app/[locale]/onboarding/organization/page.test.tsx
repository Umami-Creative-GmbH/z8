/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	getOnboardingSummaryMock,
	createOrganizationOnboardingMock,
	checkSlugAvailabilityMock,
	pushMock,
	replaceMock,
	skipOrganizationSetupMock,
	toastErrorMock,
	toastSuccessMock,
	sessionState,
} = vi.hoisted(() => ({
	createOrganizationOnboardingMock: vi.fn(),
	checkSlugAvailabilityMock: vi.fn(),
	getOnboardingSummaryMock: vi.fn(),
	pushMock: vi.fn(),
	replaceMock: vi.fn(),
	skipOrganizationSetupMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	sessionState: { account: "a", organization: "" },
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		success: toastSuccessMock,
		error: toastErrorMock,
	},
}));

vi.mock("@/app/[locale]/(app)/organization-actions", () => ({
	checkSlugAvailability: checkSlugAvailabilityMock,
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: sessionState.account },
			session: {
				id: sessionState.account,
				activeOrganizationId: sessionState.organization,
			},
		},
	}),
}));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	createOrganizationOnboarding: createOrganizationOnboardingMock,
	getOnboardingSummary: getOnboardingSummaryMock,
	skipOrganizationSetup: skipOrganizationSetupMock,
}));

import OrganizationPageClient from "./organization-page-client";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

describe("OrganizationPageClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sessionState.account = "a";
		sessionState.organization = "";
		getOnboardingSummaryMock.mockReset();
		skipOrganizationSetupMock.mockReset();
		createOrganizationOnboardingMock.mockReset();
		checkSlugAvailabilityMock.mockReset();
		checkSlugAvailabilityMock.mockResolvedValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps one organization task heading while a membership read settles", async () => {
		const summary = deferred<{
			success: true;
			data: { hasOrganization: false };
		}>();
		getOnboardingSummaryMock.mockReturnValue(summary.promise);
		render(<OrganizationPageClient canCreateOrganizations />);

		expect(
			screen.getByRole("status", { name: "Checking organization membership" }),
		).toBeTruthy();
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(
			screen.getByRole("heading", {
				level: 1,
				name: "Set up your organization",
			}),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Create Organization" }),
		).toBeNull();
		expect(skipOrganizationSetupMock).not.toHaveBeenCalled();

		await act(async () =>
			summary.resolve({ success: true, data: { hasOrganization: false } }),
		);

		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(
			screen.getByRole("heading", {
				level: 1,
				name: "Set up your organization",
			}),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Create Organization" }),
		).toBeTruthy();
	});

	it("keeps existing members on this step when the automatic skip is refused", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: true },
		});
		skipOrganizationSetupMock.mockResolvedValue({
			success: false,
			error: "Please retry",
		});
		render(<OrganizationPageClient canCreateOrganizations />);
		await waitFor(() =>
			expect(skipOrganizationSetupMock).toHaveBeenCalledOnce(),
		);
		expect(replaceMock).not.toHaveBeenCalled();
		expect(
			await screen.findByRole("button", { name: "Skip for now" }),
		).toBeTruthy();
	});

	it("discards a successful creation reply after unmount", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		const request = deferred<{ success: true }>();
		createOrganizationOnboardingMock.mockReturnValue(request.promise);
		const { unmount } = render(
			<OrganizationPageClient canCreateOrganizations />,
		);
		fireEvent.change(await screen.findByLabelText("Organization Name"), {
			target: { value: "Acme Inc" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Create Organization" }),
		);
		await waitFor(() =>
			expect(createOrganizationOnboardingMock).toHaveBeenCalledOnce(),
		);
		unmount();
		await act(async () => request.resolve({ success: true }));
		expect(pushMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it.each(["account", "organization"] as const)(
		"discards late creation across %s A to B to A without losing the new draft",
		async (scope) => {
			getOnboardingSummaryMock.mockResolvedValue({
				success: true,
				data: { hasOrganization: false },
			});
			const request = deferred<{ success: true }>();
			createOrganizationOnboardingMock.mockReturnValue(request.promise);
			const { rerender } = render(
				<OrganizationPageClient canCreateOrganizations />,
			);
			fireEvent.change(await screen.findByLabelText("Organization Name"), {
				target: { value: "Original draft" },
			});
			fireEvent.click(
				screen.getByRole("button", { name: "Create Organization" }),
			);
			await waitFor(() =>
				expect(createOrganizationOnboardingMock).toHaveBeenCalledOnce(),
			);
			for (const value of ["b", scope === "account" ? "a" : ""]) {
				sessionState[scope] = value;
				rerender(<OrganizationPageClient canCreateOrganizations />);
				await screen.findByLabelText("Organization Name");
			}
			fireEvent.change(screen.getByLabelText("Organization Name"), {
				target: { value: "New draft" },
			});
			await act(async () => request.resolve({ success: true }));
			expect(pushMock).not.toHaveBeenCalled();
			expect(toastSuccessMock).not.toHaveBeenCalled();
			expect(screen.getByLabelText("Organization Name")).toHaveProperty(
				"value",
				"New draft",
			);
		},
	);

	it("invalidates a pending skip during Activity hide and resume", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		const request = deferred<{ success: true }>();
		skipOrganizationSetupMock.mockReturnValue(request.promise);
		const { rerender } = render(
			<Activity mode="visible">
				<OrganizationPageClient canCreateOrganizations />
			</Activity>,
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Skip for now" }),
		);
		rerender(
			<Activity mode="hidden">
				<OrganizationPageClient canCreateOrganizations />
			</Activity>,
		);
		rerender(
			<Activity mode="visible">
				<OrganizationPageClient canCreateOrganizations />
			</Activity>,
		);
		await screen.findByRole("button", { name: "Skip for now" });
		await act(async () => request.resolve({ success: true }));
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("keeps the duplicate lock during Activity resume until the original creation settles", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		const request = deferred<{ success: true }>();
		createOrganizationOnboardingMock.mockReturnValue(request.promise);
		const { rerender } = render(
			<Activity mode="visible">
				<OrganizationPageClient canCreateOrganizations />
			</Activity>,
		);
		fireEvent.change(await screen.findByLabelText("Organization Name"), {
			target: { value: "Original draft" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Create Organization" }),
		);
		await waitFor(() =>
			expect(createOrganizationOnboardingMock).toHaveBeenCalledOnce(),
		);
		rerender(
			<Activity mode="hidden">
				<OrganizationPageClient canCreateOrganizations />
			</Activity>,
		);
		rerender(
			<Activity mode="visible">
				<OrganizationPageClient canCreateOrganizations />
			</Activity>,
		);
		const button = await screen.findByRole("button", {
			name: "Create Organization",
		});
		expect(button).toHaveProperty("disabled", true);
		fireEvent.click(button);
		expect(createOrganizationOnboardingMock).toHaveBeenCalledOnce();
		await act(async () => request.resolve({ success: true }));
		expect(pushMock).not.toHaveBeenCalled();
		await waitFor(() => expect(button).toHaveProperty("disabled", false));
	});

	it("rejects held slug A to B to A responses from an earlier visit", async () => {
		vi.useFakeTimers();
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		const first = deferred<boolean>(),
			second = deferred<boolean>(),
			current = deferred<boolean>();
		checkSlugAvailabilityMock
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise)
			.mockReturnValueOnce(current.promise);
		render(<OrganizationPageClient canCreateOrganizations />);
		await act(async () => {});
		for (const value of ["alpha", "bravo", "alpha"]) {
			fireEvent.change(screen.getByLabelText("Organization Slug"), {
				target: { value },
			});
			await act(async () => vi.advanceTimersByTime(500));
		}
		await act(async () => first.resolve(false));
		expect(
			screen.queryByText(
				"This slug is already taken. Please choose a different one.",
			),
		).toBeNull();
		await act(async () => current.resolve(false));
		await act(async () => second.resolve(true));
		expect(
			screen.getByText(
				"This slug is already taken. Please choose a different one.",
			),
		).toBeTruthy();
	});

	it("prevents repeated creation while pending and retains all input for retry", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		const request = deferred<{ success: false; error: string }>();
		createOrganizationOnboardingMock
			.mockReturnValueOnce(request.promise)
			.mockResolvedValueOnce({ success: true });
		render(
			<OrganizationPageClient
				canCreateOrganizations
				trackingSuggestedAt="2026-05-20T23:30:00Z"
			/>,
		);
		fireEvent.change(await screen.findByLabelText("Organization Name"), {
			target: { value: "Retained draft" },
		});
		fireEvent.change(screen.getByLabelText("Time tracking start date"), {
			target: { value: "2026-05-22" },
		});
		const button = screen.getByRole("button", { name: "Create Organization" });
		fireEvent.click(button);
		fireEvent.click(button);
		await waitFor(() =>
			expect(createOrganizationOnboardingMock).toHaveBeenCalledOnce(),
		);
		await act(async () =>
			request.resolve({ success: false, error: "Please retry" }),
		);
		expect(screen.getByRole("alert").textContent).toBe("Please retry");
		expect(screen.getByLabelText("Organization Name")).toHaveProperty(
			"value",
			"Retained draft",
		);
		expect(screen.getByLabelText("Time tracking start date")).toHaveProperty(
			"value",
			"2026-05-22",
		);
		await waitFor(() => expect(button).toHaveProperty("disabled", false));
		fireEvent.click(button);
		await waitFor(() => expect(pushMock).toHaveBeenCalledOnce());
		expect(createOrganizationOnboardingMock).toHaveBeenCalledTimes(2);
	});

	it("preserves a manually edited slug when the organization name changes", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		render(<OrganizationPageClient canCreateOrganizations />);

		const nameInput = await screen.findByLabelText("Organization Name");
		const slugInput = screen.getByLabelText("Organization Slug");
		fireEvent.change(nameInput, { target: { value: "Acme Inc" } });
		expect(slugInput).toHaveProperty("value", "acme-inc");

		fireEvent.change(slugInput, { target: { value: "custom-slug" } });
		fireEvent.change(nameInput, { target: { value: "Different Name" } });
		expect(slugInput).toHaveProperty("value", "custom-slug");
	});

	it("connects the slug help and live status to the labeled input", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		render(<OrganizationPageClient canCreateOrganizations />);
		const slug = await screen.findByLabelText("Organization Slug");
		const descriptions = slug
			.getAttribute("aria-describedby")
			?.split(" ")
			.map((id) => document.getElementById(id));
		expect(descriptions?.every(Boolean)).toBe(true);
		expect(descriptions?.map((node) => node?.textContent).join(" ")).toContain(
			"Used in URLs. Auto-generated from name.",
		);
	});

	it("keeps the current slug request loading when an older response resolves", async () => {
		vi.useFakeTimers();
		const olderRequest = deferred<boolean>();
		const currentRequest = deferred<boolean>();
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		checkSlugAvailabilityMock
			.mockReturnValueOnce(olderRequest.promise)
			.mockReturnValueOnce(currentRequest.promise);
		render(<OrganizationPageClient canCreateOrganizations />);
		await act(async () => {});

		const slugInput = screen.getByLabelText("Organization Slug");
		fireEvent.change(slugInput, { target: { value: "older-slug" } });
		await act(async () => vi.advanceTimersByTime(500));
		fireEvent.change(slugInput, { target: { value: "current-slug" } });
		await act(async () => vi.advanceTimersByTime(500));
		const createButton = screen.getByRole("button", {
			name: "Create Organization",
		});
		expect(createButton).toHaveProperty("disabled", true);

		await act(async () => olderRequest.resolve(true));

		expect(createButton).toHaveProperty("disabled", true);
		await act(async () => currentRequest.resolve(true));
	});

	it("keeps the current slug error when an older response resolves last", async () => {
		vi.useFakeTimers();
		const olderRequest = deferred<boolean>();
		const currentRequest = deferred<boolean>();
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		checkSlugAvailabilityMock
			.mockReturnValueOnce(olderRequest.promise)
			.mockReturnValueOnce(currentRequest.promise);
		render(<OrganizationPageClient canCreateOrganizations />);
		await act(async () => {});

		const slugInput = screen.getByLabelText("Organization Slug");
		fireEvent.change(slugInput, { target: { value: "older-slug" } });
		await act(async () => vi.advanceTimersByTime(500));
		fireEvent.change(slugInput, { target: { value: "current-slug" } });
		await act(async () => vi.advanceTimersByTime(500));
		await act(async () => currentRequest.resolve(false));
		expect(
			screen.getByText(
				"This slug is already taken. Please choose a different one.",
			),
		).toBeTruthy();

		await act(async () => olderRequest.resolve(true));

		expect(
			screen.getByText(
				"This slug is already taken. Please choose a different one.",
			),
		).toBeTruthy();
	});

	it("shows the tracking suggestion separately from employment and submits the chosen rollout date", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		createOrganizationOnboardingMock.mockResolvedValue({ success: true });
		render(
			<OrganizationPageClient
				canCreateOrganizations
				trackingSuggestedAt="2026-05-20T23:30:00Z"
			/>,
		);
		const date = await screen.findByLabelText("Time tracking start date");
		expect(date).toHaveProperty("value", "2026-05-20");
		fireEvent.change(date, { target: { value: "2026-05-21" } });
		fireEvent.change(screen.getByLabelText("Organization Name"), {
			target: { value: "Acme Inc" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Create Organization" }),
		);
		await waitFor(() =>
			expect(createOrganizationOnboardingMock).toHaveBeenCalledWith(
				expect.objectContaining({
					trackingStartDate: "2026-05-21",
					timezone: "UTC",
				}),
			),
		);
	});

	it("keeps submit disabled after successful creation navigation", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		createOrganizationOnboardingMock.mockResolvedValue({ success: true });
		render(<OrganizationPageClient canCreateOrganizations />);

		fireEvent.change(await screen.findByPlaceholderText("Acme Inc."), {
			target: { value: "Acme Inc" },
		});
		const createButton = screen.getByRole("button", {
			name: "Create Organization",
		});
		fireEvent.click(createButton);

		await waitFor(() =>
			expect(pushMock).toHaveBeenCalledWith("/onboarding/profile"),
		);
		expect(pushMock).toHaveBeenCalledOnce();
		expect(createButton).toHaveProperty("disabled", true);
	});

	it("keeps skip disabled after successful skip navigation", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		skipOrganizationSetupMock.mockResolvedValue({ success: true });
		render(<OrganizationPageClient canCreateOrganizations />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);

		await waitFor(() =>
			expect(pushMock).toHaveBeenCalledWith("/onboarding/profile"),
		);
		expect(pushMock).toHaveBeenCalledOnce();
		expect(skipButton).toHaveProperty("disabled", true);
	});

	it("resets submit loading and shows a safe error when creation rejects", async () => {
		const request = deferred<never>();
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		createOrganizationOnboardingMock.mockReturnValue(request.promise);
		render(<OrganizationPageClient canCreateOrganizations />);

		fireEvent.change(await screen.findByPlaceholderText("Acme Inc."), {
			target: { value: "Acme Inc" },
		});
		const createButton = screen.getByRole("button", {
			name: "Create Organization",
		});
		fireEvent.click(createButton);
		await waitFor(() => expect(createButton).toHaveProperty("disabled", true));

		await act(async () =>
			request.reject(new Error("private creation failure")),
		);

		await waitFor(() => expect(createButton).toHaveProperty("disabled", false));
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to create organization",
		);
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("resets skip loading and shows a safe error when skipping rejects", async () => {
		const request = deferred<never>();
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});
		skipOrganizationSetupMock.mockReturnValue(request.promise);
		render(<OrganizationPageClient canCreateOrganizations />);

		const skipButton = await screen.findByRole("button", {
			name: "Skip for now",
		});
		fireEvent.click(skipButton);
		await waitFor(() => expect(skipButton).toHaveProperty("disabled", true));

		await act(async () => request.reject(new Error("private skip failure")));

		await waitFor(() => expect(skipButton).toHaveProperty("disabled", false));
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to skip organization setup",
		);
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("hides the creation form when organization creation is disabled", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});

		render(<OrganizationPageClient canCreateOrganizations={false} />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
		});

		expect(screen.queryByText("Create Organization")).toBeNull();
		expect(screen.queryByPlaceholderText("Acme Inc.")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Create Organization" }),
		).toBeNull();
	});

	it("explains creation is disabled when the creation form is unavailable", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});

		render(<OrganizationPageClient canCreateOrganizations={false} />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
		});

		expect(
			screen.getByText(
				"Organization creation is disabled for this deployment.",
			),
		).toBeTruthy();
		expect(
			screen.getByText(
				"You can continue by skipping this step while you wait for an invitation to an existing organization.",
			),
		).toBeTruthy();
		expect(
			screen.queryByText(
				"Create your organization to unlock all features, or skip if you're waiting for an invitation.",
			),
		).toBeNull();
	});

	it("does not skip or navigate when a membership result resolves after unmount", async () => {
		const request = deferred<{
			success: true;
			data: { hasOrganization: true };
		}>();
		getOnboardingSummaryMock.mockReturnValue(request.promise);
		const { unmount } = render(
			<OrganizationPageClient canCreateOrganizations />,
		);
		await waitFor(() =>
			expect(getOnboardingSummaryMock).toHaveBeenCalledOnce(),
		);

		unmount();
		await act(async () => {
			request.resolve({ success: true, data: { hasOrganization: true } });
			await request.promise;
		});

		expect(skipOrganizationSetupMock).not.toHaveBeenCalled();
		expect(replaceMock).not.toHaveBeenCalled();
	});

	it("settles membership loading safely when the summary rejects", async () => {
		const request = deferred<never>();
		getOnboardingSummaryMock.mockReturnValue(request.promise);
		render(<OrganizationPageClient canCreateOrganizations />);

		await act(async () => {
			request.reject(new Error("private summary failure"));
		});

		expect(
			await screen.findByRole("button", { name: "Skip for now" }),
		).toBeTruthy();
		expect(skipOrganizationSetupMock).not.toHaveBeenCalled();
		expect(replaceMock).not.toHaveBeenCalled();
	});

	it("runs the membership skip once during StrictMode replay", async () => {
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: true },
		});
		skipOrganizationSetupMock.mockResolvedValue({ success: true });

		render(
			<StrictMode>
				<OrganizationPageClient canCreateOrganizations />
			</StrictMode>,
		);

		await waitFor(() =>
			expect(replaceMock).toHaveBeenCalledWith("/onboarding/profile"),
		);
		expect(getOnboardingSummaryMock).toHaveBeenCalledTimes(2);
		expect(skipOrganizationSetupMock).toHaveBeenCalledOnce();
		expect(replaceMock).toHaveBeenCalledOnce();
	});
});
