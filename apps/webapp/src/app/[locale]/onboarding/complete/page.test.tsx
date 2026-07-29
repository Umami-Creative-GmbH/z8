/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	completeOnboardingMock,
	getOnboardingSummaryMock,
	pushMock,
	toastErrorMock,
	translate,
} = vi.hoisted(() => ({
	completeOnboardingMock: vi.fn(),
	getOnboardingSummaryMock: vi.fn(),
	pushMock: vi.fn(),
	toastErrorMock: vi.fn(),
	translate: (_key: string, fallback?: string) => fallback ?? _key,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: translate,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/onboarding/progress-indicator", () => ({
	ProgressIndicator: () => null,
}));

vi.mock("./actions", () => ({
	completeOnboarding: completeOnboardingMock,
	getOnboardingSummary: getOnboardingSummaryMock,
}));

import CompletePage from "./page";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("CompletePage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("omits the setup summary card after onboarding completes", async () => {
		completeOnboardingMock.mockResolvedValue({ success: true });
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: {
				hasOrganization: true,
				organizationName: "Acme",
				profileCompleted: true,
				workPolicySet: false,
				isAdmin: true,
				vacationPolicyCreated: false,
				holidayPresetCreated: false,
				workTemplateCreated: false,
				notificationsConfigured: false,
			},
		});

		render(<CompletePage />);

		await waitFor(() => {
			expect(screen.getByText("You're all set!")).toBeTruthy();
		});

		expect(screen.queryByText("What You've Set Up")).toBeNull();
		expect(screen.queryByText("Vacation policy skipped")).toBeNull();
		expect(screen.queryByText("Holidays skipped")).toBeNull();
		expect(screen.queryByText("Work template skipped")).toBeNull();
		expect(screen.getByText("Next Steps")).toBeTruthy();
	});

	it("does not report a completion failure after unmount", async () => {
		const completion = deferred<{ success: false; error: string }>();
		completeOnboardingMock.mockReturnValue(completion.promise);

		const { unmount } = render(<CompletePage />);
		await waitFor(() => expect(completeOnboardingMock).toHaveBeenCalledOnce());
		unmount();

		await act(async () => {
			completion.resolve({ success: false, error: "Stale completion failure" });
			await completion.promise;
		});

		expect(toastErrorMock).not.toHaveBeenCalled();
		expect(getOnboardingSummaryMock).not.toHaveBeenCalled();
	});

	it("does not report a summary failure after unmount", async () => {
		const summary = deferred<{ success: false; error: string }>();
		completeOnboardingMock.mockResolvedValue({ success: true });
		getOnboardingSummaryMock.mockReturnValue(summary.promise);

		const { unmount } = render(<CompletePage />);
		await waitFor(() =>
			expect(getOnboardingSummaryMock).toHaveBeenCalledOnce(),
		);
		unmount();

		await act(async () => {
			summary.resolve({ success: false, error: "Stale summary failure" });
			await summary.promise;
		});

		expect(toastErrorMock).not.toHaveBeenCalled();
	});

	it("runs the completion mutation once during StrictMode replay", async () => {
		completeOnboardingMock.mockResolvedValue({ success: true });
		getOnboardingSummaryMock.mockResolvedValue({
			success: true,
			data: { hasOrganization: false },
		});

		render(
			<StrictMode>
				<CompletePage />
			</StrictMode>,
		);

		expect(await screen.findByText("You're all set!")).toBeTruthy();
		expect(completeOnboardingMock).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole("button", { name: "Go to Dashboard" }));
		expect(pushMock).toHaveBeenCalledWith("/init");
	});

	it("settles loading with a safe error when completion rejects", async () => {
		completeOnboardingMock.mockRejectedValue(new Error("mutation internals"));

		render(<CompletePage />);

		expect(await screen.findByText("You're all set!")).toBeTruthy();
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to complete onboarding",
		);
		expect(screen.queryByText("mutation internals")).toBeNull();
		expect(getOnboardingSummaryMock).not.toHaveBeenCalled();
	});

	it("settles loading with a safe error when summary rejects", async () => {
		completeOnboardingMock.mockResolvedValue({ success: true });
		getOnboardingSummaryMock.mockRejectedValue(new Error("summary internals"));

		render(<CompletePage />);

		expect(await screen.findByText("You're all set!")).toBeTruthy();
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Failed to get onboarding summary",
		);
		expect(screen.queryByText("summary internals")).toBeNull();
	});
});
