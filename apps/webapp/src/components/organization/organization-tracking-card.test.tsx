/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), commit: vi.fn(), refresh: vi.fn() }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
	Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/app/[locale]/(app)/settings/organizations/tracking-date-actions", () => ({
	previewOrganizationTrackingDateAction: mocks.preview,
	commitOrganizationTrackingDateAction: mocks.commit,
}));

import { OrganizationTrackingCard } from "./organization-tracking-card";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
describe("organization tracking review", () => {
	it("suggests creation in organization zone and requires a reviewed impact before activation", async () => {
		mocks.preview.mockResolvedValue({
			success: true,
			data: {
				kind: "activation",
				currentDate: null,
				proposedDate: "2026-05-21",
				fingerprint: "reviewed",
				employees: [],
				blockers: [],
			},
		});
		mocks.commit.mockResolvedValue({
			success: false,
			code: "stale_preview",
			error: "The reviewed inputs changed. Generate a new preview before saving.",
		});
		render(
			<OrganizationTrackingCard
				settings={{ active: false, trackingStartDate: null }}
				createdAt="2026-05-20T23:30:00Z"
				timezone="Europe/Berlin"
			/>,
		);
		expect(screen.getByLabelText("Time tracking start date")).toHaveProperty("value", "2026-05-21");
		expect(screen.queryByRole("button", { name: "Activate reviewed date" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Preview impact" }));
		await screen.findByRole("button", { name: "Activate reviewed date" });
		fireEvent.change(screen.getByLabelText("Reason for this change"), {
			target: { value: "Our actual rollout" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Activate reviewed date" }));
		await waitFor(() =>
			expect(mocks.commit).toHaveBeenCalledWith({
				trackingStartDate: "2026-05-21",
				fingerprint: "reviewed",
				reason: "Our actual rollout",
			}),
		);
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"The reviewed inputs changed. Generate a new preview before saving.",
		);
		expect(screen.queryByRole("button", { name: "Activate reviewed date" })).toBeNull();
	});
	it("offers an active organization a date change and a reviewed save", async () => {
		mocks.preview.mockResolvedValue({
			success: true,
			data: {
				kind: "date_change",
				currentDate: "2026-05-21",
				proposedDate: "2026-05-26",
				fingerprint: "changed",
				employees: [],
				blockers: [],
			},
		});
		mocks.commit.mockResolvedValue({
			success: true,
			data: { status: "committed", refreshPending: false },
		});
		render(
			<OrganizationTrackingCard
				settings={{ active: true, trackingStartDate: "2026-05-21" }}
				createdAt="2026-01-01T00:00:00Z"
				timezone="Europe/Berlin"
			/>,
		);
		fireEvent.change(screen.getByLabelText("Time tracking start date"), {
			target: { value: "2026-05-26" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Change tracking date" }));
		await screen.findByRole("button", { name: "Save reviewed date" });
		fireEvent.change(screen.getByLabelText("Reason for this change"), {
			target: { value: "Correct rollout date" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save reviewed date" }));
		expect(await screen.findByRole("status")).toHaveProperty(
			"textContent",
			"Tracking date saved and balances updated.",
		);
		expect(mocks.refresh).toHaveBeenCalled();
	});
});
