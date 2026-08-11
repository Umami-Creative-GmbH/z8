/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/to-have-text-content";

const mockState = vi.hoisted(() => ({
	compareInstants: vi.fn(() => -1),
	findInvitation: vi.fn(),
	instantFromDate: vi.fn(() => "expiration-instant"),
	nowInstant: vi.fn(() => "current-instant"),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			invitation: { findFirst: mockState.findInvitation },
		},
	},
	invitation: { id: "invitation.id" },
}));

vi.mock("@/lib/datetime/temporal-core", () => ({
	compareInstants: mockState.compareInstants,
	instantFromDate: mockState.instantFromDate,
	systemClock: { nowInstant: mockState.nowInstant },
}));

vi.mock("@/components/accept-invitation-form", () => ({
	AcceptInvitationForm: "AcceptInvitationForm",
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const { default: AcceptInvitationPage } = await import("./page");

function getContentElement(page: ReturnType<typeof AcceptInvitationPage>) {
	return page.props.children;
}

describe("AcceptInvitationPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.compareInstants.mockReturnValue(-1);
		mockState.findInvitation.mockResolvedValue({
			email: "invitee@example.com",
			expiresAt: new Date("2026-08-11T00:00:00.000Z"),
			organization: { name: "Acme" },
			role: "member",
			status: "pending",
			user: { name: "Ada Admin" },
		});
	});

	it("renders a generic auth fallback while params remain unresolved", () => {
		const page = AcceptInvitationPage({
			params: new Promise<never>(() => {}),
		});
		const contentElement = getContentElement(page);
		const content = contentElement.type(contentElement.props);

		render(page.props.fallback);

		const loading = screen.getByRole("status");
		const label = loading.querySelector<HTMLElement>(".sr-only");
		expect(loading.getAttribute("aria-busy")).toBe("true");
		expect(label).not.toBeNull();
		if (label) {
			expect(label).toHaveTextContent("Loading authentication");
		}
		expect(screen.queryByText("Acme")).toBeNull();
		expect(screen.queryByText("Ada Admin")).toBeNull();
		expect(mockState.findInvitation).not.toHaveBeenCalled();
		expect(content).toBeInstanceOf(Promise);
	});

	it("loads the invitation and preserves Temporal expiration mapping", async () => {
		const page = AcceptInvitationPage({
			params: Promise.resolve({ invitationId: "invitation-1" }),
		});
		const contentElement = getContentElement(page);

		const form = await contentElement.type(contentElement.props);

		expect(mockState.findInvitation).toHaveBeenCalledWith({
			where: { eq: ["invitation.id", "invitation-1"] },
			with: {
				organization: { columns: { name: true } },
				user: { columns: { name: true } },
			},
		});
		expect(mockState.instantFromDate).toHaveBeenCalledWith(
			new Date("2026-08-11T00:00:00.000Z"),
		);
		expect(mockState.nowInstant).toHaveBeenCalledOnce();
		expect(mockState.compareInstants).toHaveBeenCalledWith(
			"expiration-instant",
			"current-instant",
		);
		expect(form.props).toEqual({
			invitation: {
				email: "invitee@example.com",
				inviterName: "Ada Admin",
				isExpired: true,
				organizationName: "Acme",
				role: "member",
				status: "pending",
			},
			invitationId: "invitation-1",
		});
	});
});
