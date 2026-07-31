/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
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
} = vi.hoisted(() => ({
	createOrganizationOnboardingMock: vi.fn(),
	checkSlugAvailabilityMock: vi.fn(),
	getOnboardingSummaryMock: vi.fn(),
	pushMock: vi.fn(),
	replaceMock: vi.fn(),
	skipOrganizationSetupMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
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
		getOnboardingSummaryMock.mockReset();
		skipOrganizationSetupMock.mockReset();
		createOrganizationOnboardingMock.mockReset();
		checkSlugAvailabilityMock.mockReset();
		checkSlugAvailabilityMock.mockResolvedValue(true);
	});

	afterEach(() => {
		vi.useRealTimers();
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
