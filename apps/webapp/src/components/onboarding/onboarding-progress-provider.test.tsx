/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingStep } from "@/lib/validations/onboarding";

const mocks = vi.hoisted(() => ({
	getOnboardingIsAdmin: vi.fn(),
	session: {
		data: {
			user: { id: "user-1" },
			session: { activeOrganizationId: null as string | null },
		} as {
			user: { id: string };
			session: { activeOrganizationId: string | null };
		} | null,
		isPending: false,
	},
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)\}/g, (_match, name: string) =>
				String(params?.[name] ?? `{${name}}`),
			),
	}),
}));

vi.mock("@/lib/auth-client", () => ({
	useSession: () => mocks.session,
}));

vi.mock("@/app/[locale]/onboarding/actions", () => ({
	getOnboardingIsAdmin: mocks.getOnboardingIsAdmin,
}));

import {
	OnboardingProgressProvider,
	useOnboardingIsAdmin,
	useRefreshOnboardingIsAdmin,
} from "./onboarding-progress-provider";
import { ProgressIndicator } from "./progress-indicator";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function StatusProbe({ step }: { step: OnboardingStep }) {
	const isAdmin = useOnboardingIsAdmin();
	const refresh = useRefreshOnboardingIsAdmin();
	return (
		<div>
			<span data-testid="admin-flag">{String(isAdmin)}</span>
			<button type="button" onClick={() => void refresh()}>
				Refresh
			</button>
			<ProgressIndicator currentStep={step} />
		</div>
	);
}

describe("OnboardingProgressProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getOnboardingIsAdmin.mockReset();
		mocks.session = {
			data: {
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-1" },
			},
			isPending: false,
		};
	});

	afterEach(() => {
		cleanup();
	});

	it("seeds initialIsAdmin without flicker or redundant refetch when the session scope matches", () => {
		render(
			<OnboardingProgressProvider
				initialIsAdmin={true}
				initialUserId="user-1"
				initialOrganizationId="org-1"
			>
				<StatusProbe step="wellness" />
			</OnboardingProgressProvider>,
		);

		expect(screen.getByTestId("admin-flag").textContent).toBe("true");
		expect(screen.getAllByRole("listitem")).toHaveLength(8);
		expect(mocks.getOnboardingIsAdmin).not.toHaveBeenCalled();
	});

	it("preserves server-seeded admin state while the client session is still pending", () => {
		mocks.session = { data: null, isPending: true };
		render(
			<OnboardingProgressProvider
				initialIsAdmin={true}
				initialUserId="user-1"
				initialOrganizationId="org-1"
			>
				<StatusProbe step="notifications" />
			</OnboardingProgressProvider>,
		);

		expect(screen.getByTestId("admin-flag").textContent).toBe("true");
		expect(screen.getAllByRole("listitem")).toHaveLength(8);
		expect(mocks.getOnboardingIsAdmin).not.toHaveBeenCalled();
	});

	it("updates ProgressIndicator smoothly when a user creates an organization mid-flow", async () => {
		mocks.session = {
			data: { user: { id: "user-1" }, session: { activeOrganizationId: null } },
			isPending: false,
		};
		mocks.getOnboardingIsAdmin.mockResolvedValue({ success: true, data: true });

		const view = render(
			<OnboardingProgressProvider
				initialIsAdmin={false}
				initialUserId="user-1"
				initialOrganizationId={null}
			>
				<StatusProbe step="organization" />
			</OnboardingProgressProvider>,
		);

		expect(screen.getByTestId("admin-flag").textContent).toBe("false");
		expect(screen.getAllByRole("listitem")).toHaveLength(6);

		// Simulate activeOrganizationId updating after organization creation.
		mocks.session = {
			data: { user: { id: "user-1" }, session: { activeOrganizationId: "org-new" } },
			isPending: false,
		};
		view.rerender(
			<OnboardingProgressProvider
				initialIsAdmin={false}
				initialUserId="user-1"
				initialOrganizationId={null}
			>
				<StatusProbe step="profile" />
			</OnboardingProgressProvider>,
		);

		await waitFor(() => expect(screen.getByTestId("admin-flag").textContent).toBe("true"));
		expect(screen.getAllByRole("listitem")).toHaveLength(8);
		expect(mocks.getOnboardingIsAdmin).toHaveBeenCalledOnce();

		// Subsequent non-admin-only steps keep all 8 org-admin steps without jumping back to 6.
		for (const step of ["wellness", "notifications", "complete"] as const) {
			view.rerender(
				<OnboardingProgressProvider
					initialIsAdmin={false}
					initialUserId="user-1"
					initialOrganizationId={null}
				>
					<StatusProbe step={step} />
				</OnboardingProgressProvider>,
			);
			expect(screen.getAllByRole("listitem")).toHaveLength(8);
		}
	});

	it("keeps non-admin org members at 6 steps across every step", () => {
		const view = render(
			<OnboardingProgressProvider
				initialIsAdmin={false}
				initialUserId="user-1"
				initialOrganizationId="org-1"
			>
				<StatusProbe step="welcome" />
			</OnboardingProgressProvider>,
		);

		for (const step of [
			"welcome",
			"organization",
			"profile",
			"wellness",
			"notifications",
			"complete",
		] as const) {
			view.rerender(
				<OnboardingProgressProvider
					initialIsAdmin={false}
					initialUserId="user-1"
					initialOrganizationId="org-1"
				>
					<StatusProbe step={step} />
				</OnboardingProgressProvider>,
			);
			expect(screen.getAllByRole("listitem")).toHaveLength(6);
			expect(screen.queryByText("Vacation")).toBeNull();
			expect(screen.queryByText("Templates")).toBeNull();
		}
	});

	it("ignores stale out-of-order admin responses after switching organizations", async () => {
		const orgB = deferred<{ success: true; data: true }>();
		const orgC = deferred<{ success: true; data: false }>();
		mocks.getOnboardingIsAdmin.mockReturnValueOnce(orgB.promise).mockReturnValueOnce(orgC.promise);

		const view = render(
			<OnboardingProgressProvider
				initialIsAdmin={false}
				initialUserId="user-1"
				initialOrganizationId="org-1"
			>
				<StatusProbe step="profile" />
			</OnboardingProgressProvider>,
		);

		mocks.session = {
			data: { user: { id: "user-1" }, session: { activeOrganizationId: "org-b" } },
			isPending: false,
		};
		view.rerender(
			<OnboardingProgressProvider
				initialIsAdmin={false}
				initialUserId="user-1"
				initialOrganizationId="org-1"
			>
				<StatusProbe step="profile" />
			</OnboardingProgressProvider>,
		);

		mocks.session = {
			data: { user: { id: "user-1" }, session: { activeOrganizationId: "org-c" } },
			isPending: false,
		};
		view.rerender(
			<OnboardingProgressProvider
				initialIsAdmin={false}
				initialUserId="user-1"
				initialOrganizationId="org-1"
			>
				<StatusProbe step="profile" />
			</OnboardingProgressProvider>,
		);

		await act(async () => {
			orgC.resolve({ success: true, data: false });
			orgB.resolve({ success: true, data: true });
		});

		expect(screen.getByTestId("admin-flag").textContent).toBe("false");
		expect(screen.getAllByRole("listitem")).toHaveLength(6);
	});

	it("resets admin state to false when the session signs out", () => {
		const view = render(
			<OnboardingProgressProvider
				initialIsAdmin={true}
				initialUserId="user-1"
				initialOrganizationId="org-1"
			>
				<StatusProbe step="profile" />
			</OnboardingProgressProvider>,
		);
		expect(screen.getByTestId("admin-flag").textContent).toBe("true");

		mocks.session = { data: null, isPending: false };
		view.rerender(
			<OnboardingProgressProvider
				initialIsAdmin={true}
				initialUserId="user-1"
				initialOrganizationId="org-1"
			>
				<StatusProbe step="profile" />
			</OnboardingProgressProvider>,
		);

		expect(screen.getByTestId("admin-flag").textContent).toBe("false");
		expect(screen.getAllByRole("listitem")).toHaveLength(6);
		expect(mocks.getOnboardingIsAdmin).not.toHaveBeenCalled();
	});

	it("updates admin state immediately when refreshIsAdmin is called after organization creation", async () => {
		mocks.session = {
			data: { user: { id: "user-1" }, session: { activeOrganizationId: null } },
			isPending: false,
		};
		mocks.getOnboardingIsAdmin.mockResolvedValue({ success: true, data: true });

		render(
			<OnboardingProgressProvider
				initialIsAdmin={false}
				initialUserId="user-1"
				initialOrganizationId={null}
			>
				<StatusProbe step="organization" />
			</OnboardingProgressProvider>,
		);

		expect(screen.getAllByRole("listitem")).toHaveLength(6);
		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

		await waitFor(() => expect(screen.getByTestId("admin-flag").textContent).toBe("true"));
		expect(screen.getAllByRole("listitem")).toHaveLength(8);
		expect(mocks.getOnboardingIsAdmin).toHaveBeenCalledOnce();
	});
});
