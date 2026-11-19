/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { acceptInvitationMock, pushMock, signOutMock } = vi.hoisted(() => ({
	acceptInvitationMock: vi.fn(),
	pushMock: vi.fn(),
	signOutMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			defaultValue?: string,
			params?: Record<string, string | number>,
		) => {
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
}));
vi.mock("@/lib/auth/use-auth-page-session", () => ({
	useAuthPageSession: useSessionMock,
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href, ...props }: React.ComponentProps<"a">) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({ push: pushMock }),
}));

import { DomainAuthProvider } from "@/lib/auth/domain-auth-context";
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
			screen
				.getByRole("link", { name: "Sign in with invited email" })
				.getAttribute("href"),
		).toContain("/sign-in");
		expect(
			screen
				.getByRole("link", { name: "Create account with invited email" })
				.getAttribute("href"),
		).toContain("/sign-up");
		const actions = screen.getAllByRole("link");
		expect(actions[0].textContent).toBe("Create account with invited email");
		const registration = new URL(
			actions[0].getAttribute("href") ?? "",
			"https://example.com",
		);
		expect(registration.searchParams.get("invitedEmail")).toBe(
			"alex@example.com",
		);
		expect(registration.searchParams.get("invitationId")).toBe("invite_123");
		expect(registration.searchParams.get("callbackUrl")).toBe(
			"/accept-invitation/invite_123",
		);
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

		expect(
			screen.getByRole("button", { name: "Accept invitation" }),
		).toBeTruthy();
		expect(acceptInvitationMock).not.toHaveBeenCalled();
	});

	it("recovers with an error when invitation acceptance throws", async () => {
		acceptInvitationMock.mockRejectedValueOnce(
			new Error("Network request failed"),
		);
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
		expect(screen.queryByText("Invitation unavailable")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Accept invitation" }),
		).toBeTruthy();
	});

	it("uses the domain brand and a single task heading for the invitation review", () => {
		render(
			<DomainAuthProvider
				domainContext={{
					organizationId: "org-1",
					domain: "example.test",
					authConfig: {
						emailPasswordEnabled: true,
						socialProvidersEnabled: [],
						ssoEnabled: false,
						passkeyEnabled: false,
					},
					branding: {
						appName: "Northwind Time",
						primaryColor: "#2563eb",
						accentColor: null,
						logoUrl: null,
						backgroundImageUrl: null,
					},
					socialOAuthConfigured: {
						google: false,
						github: false,
						linkedin: false,
						apple: false,
					},
					turnstile: { enabled: false, siteKey: null, isEnterprise: false },
				}}
			>
				<AcceptInvitationForm
					invitation={{
						email: "alex@example.com",
						inviterName: "Jamie",
						isExpired: false,
						organizationName: "Northwind Ops",
						role: "member",
						status: "pending",
					}}
					invitationId="invite_123"
				/>
			</DomainAuthProvider>,
		);
		expect(screen.getByText("Northwind Time")).toBeTruthy();
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(
			screen.getByRole("region", { name: "Invitation details" }).textContent,
		).toContain("alex@example.com");
	});

	it("keeps account switching recoverable when sign-out fails", async () => {
		useSessionMock.mockReturnValue({
			data: { user: { email: "other@example.com" } },
			isPending: false,
		});
		signOutMock.mockRejectedValueOnce(new Error("Sign-out request failed"));
		render(
			<AcceptInvitationForm
				invitation={{
					email: "alex@example.com",
					inviterName: "Jamie",
					isExpired: false,
					organizationName: "Northwind Ops",
					role: "member",
					status: "pending",
				}}
				invitationId="invite_123"
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Sign out and switch account" }),
		);
		await waitFor(() =>
			expect(screen.getByText("Sign-out request failed")).toBeTruthy(),
		);
		expect(
			screen
				.getByRole("button", { name: "Sign out and switch account" })
				.hasAttribute("disabled"),
		).toBe(false);
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("announces pending acceptance, prevents duplicate submission, and retains retry after a refusal", async () => {
		useSessionMock.mockReturnValue({
			data: { user: { email: " ALEX@EXAMPLE.COM " } },
			isPending: false,
		});
		let refuse: (value: { error: { message: string } }) => void = () => {};
		acceptInvitationMock.mockReturnValue(
			new Promise((resolve) => {
				refuse = resolve;
			}),
		);
		render(
			<AcceptInvitationForm
				invitation={{
					email: "alex@example.com",
					inviterName: "Jamie",
					isExpired: false,
					organizationName: "Northwind Ops",
					role: "member",
					status: "pending",
				}}
				invitationId="invite_123"
			/>,
		);
		const button = screen.getByRole("button", { name: "Accept invitation" });
		expect(button.getAttribute("type")).toBe("button");
		fireEvent.click(button);
		await waitFor(() =>
			expect(screen.getByRole("status").textContent).toBe(
				"Accepting invitation…",
			),
		);
		expect(button.hasAttribute("disabled")).toBe(true);
		fireEvent.click(button);
		await waitFor(() => expect(acceptInvitationMock).toHaveBeenCalledOnce());
		refuse({ error: { message: "Invitation no longer pending" } });
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain(
				"Invitation no longer pending",
			),
		);
		expect(
			screen
				.getByRole("button", { name: "Accept invitation" })
				.hasAttribute("disabled"),
		).toBe(false);
		expect(
			screen.getByRole("region", { name: "Invitation details" }).textContent,
		).toContain("Northwind Ops");
	});

	it.each([
		null,
		{ isExpired: true, status: "pending" },
		{ isExpired: false, status: "canceled" },
		{ isExpired: false, status: "accepted" },
		{ isExpired: false, status: "rejected" },
	])(
		"refuses an unavailable invitation without offering acceptance or registration (%j)",
		(variant) => {
			useSessionMock.mockReturnValue({
				data: { user: { email: "alex@example.com" } },
				isPending: false,
			});
			render(
				<AcceptInvitationForm
					invitation={
						variant
							? {
									email: "alex@example.com",
									inviterName: null,
									organizationName: null,
									role: null,
									...variant,
								}
							: null
					}
					invitationId="invite_123"
				/>,
			);
			expect(screen.getByRole("alert").textContent).toContain(
				"Invitation unavailable",
			);
			expect(
				screen.queryByRole("button", { name: "Accept invitation" }),
			).toBeNull();
			expect(
				screen.queryByRole("link", {
					name: "Create account with invited email",
				}),
			).toBeNull();
		},
	);

	it("announces session loading without offering an action before identity resolves", () => {
		useSessionMock.mockReturnValue({ data: null, isPending: true });
		render(
			<AcceptInvitationForm invitation={null} invitationId="invite_123" />,
		);
		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.queryByRole("button")).toBeNull();
	});
});
