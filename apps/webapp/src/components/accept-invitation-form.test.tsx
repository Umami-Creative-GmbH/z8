/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { acceptInvitationMock, pushMock, signOutMock } = vi.hoisted(() => ({
	acceptInvitationMock: vi.fn(),
	pushMock: vi.fn(),
	signOutMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string, params?: Record<string, string | number>) => {
			if (!defaultValue) {
				return _key;
			}

			return defaultValue.replace(/\{(\w+)\}/g, (_, token: string) =>
				String(params?.[token] ?? `{${token}}`),
			);
		},
	}),
}));

const { useSessionMock } = vi.hoisted(() => ({
	useSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		organization: {
			acceptInvitation: acceptInvitationMock,
		},
		signOut: signOutMock,
	},
	useSession: useSessionMock,
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("./auth-form-wrapper", () => ({
	AuthFormWrapper: ({ children, title }: { children: ReactNode; title: string }) => (
		<div>
			<h1>{title}</h1>
			{children}
		</div>
	),
}));

import { AcceptInvitationForm } from "./accept-invitation-form";

describe("AcceptInvitationForm", () => {
	beforeEach(() => {
		acceptInvitationMock.mockReset();
		pushMock.mockReset();
		signOutMock.mockReset();
		useSessionMock.mockReturnValue({
			data: null,
			isPending: false,
		});
	});

	it("gives signed-out users a clear next-step briefing", () => {
		render(
			<AcceptInvitationForm
				invitation={{
					email: "alex@example.com",
					inviterName: "Jamie",
					isExpired: false,
					organizationName: "Northwind Ops",
					role: "manager",
					status: "pending",
				}}
				invitationId="invite_123"
			/>,
		);

		expect(screen.getByText("What happens next")).toBeTruthy();
		expect(
			screen.getByText(
				"Use the invited email address so the workspace can match this invitation automatically.",
			),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Sign in with invited email" }).getAttribute("href"),
		).toContain("/sign-in");
		expect(
			screen.getByRole("link", { name: "Create account with invited email" }).getAttribute("href"),
		).toContain("/sign-up");
	});

	it("shows one clear message when the signed-in account does not match the invitation", () => {
		useSessionMock.mockReturnValue({
			data: {
				user: {
					email: "other@example.com",
				},
			},
			isPending: false,
		});

		render(
			<AcceptInvitationForm
				invitation={{
					email: "alex@example.com",
					inviterName: "Jamie",
					isExpired: false,
					organizationName: "Northwind Ops",
					role: "manager",
					status: "pending",
				}}
				invitationId="invite_123"
			/>,
		);

		expect(
			screen.getAllByText(
				"You're signed in as a different email. Sign out and use the invited email address to accept this invitation.",
			),
		).toHaveLength(1);
	});

	it("lets the invited signed-in user review details before accepting", () => {
		useSessionMock.mockReturnValue({
			data: {
				user: {
					email: "alex@example.com",
				},
			},
			isPending: false,
		});

		render(
			<AcceptInvitationForm
				invitation={{
					email: "alex@example.com",
					inviterName: "Jamie",
					isExpired: false,
					organizationName: "Northwind Ops",
					role: "manager",
					status: "pending",
				}}
				invitationId="invite_123"
			/>,
		);

		expect(screen.getByRole("button", { name: "Accept invitation" })).toBeTruthy();
		expect(acceptInvitationMock).not.toHaveBeenCalled();
	});

	it("recovers with an error when invitation acceptance throws", async () => {
		acceptInvitationMock.mockRejectedValueOnce(new Error("Network request failed"));
		useSessionMock.mockReturnValue({
			data: {
				user: {
					email: "alex@example.com",
				},
			},
			isPending: false,
		});

		render(
			<AcceptInvitationForm
				invitation={{
					email: "alex@example.com",
					inviterName: "Jamie",
					isExpired: false,
					organizationName: "Northwind Ops",
					role: "manager",
					status: "pending",
				}}
				invitationId="invite_123"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));

		await waitFor(() => {
			expect(screen.getByText("Network request failed")).toBeTruthy();
		});
		expect(screen.queryByText("Accepting invitation…")).toBeNull();
	});
});
