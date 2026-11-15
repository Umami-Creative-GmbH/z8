/* @vitest-environment jsdom */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JoinOrganizationForm } from "./join-organization-form";

const mocks = vi.hoisted(() => ({
	validateInviteCode: vi.fn(),
	redeemInviteCode: vi.fn(),
	session: null as {
		user: { id: string; email: string };
		session: { activeOrganizationId: string };
	} | null,
	push: vi.fn(),
	locale: "en",
	translate: (
		_key: string,
		fallback: string,
		values?: Record<string, string>,
	) => fallback.replace(/\{(\w+)\}/g, (match, key) => values?.[key] ?? match),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: mocks.translate }),
}));
vi.mock("next-intl", () => ({ useLocale: () => mocks.locale }));

vi.mock("@/app/[locale]/(auth)/invite-code-actions", () => ({
	redeemInviteCode: mocks.redeemInviteCode,
	validateInviteCode: mocks.validateInviteCode,
}));

vi.mock("@/lib/auth/use-auth-page-session", () => ({
	useAuthPageSession: () => ({ data: mocks.session, isPending: false }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: mocks.push }),
}));

function joinForm() {
	const form = screen.getByLabelText("Invite Code").closest("form");
	if (!form) throw new Error("Join form missing");
	return form;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("JoinOrganizationForm admission flow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.session = null;
		mocks.locale = "en";
	});

	it("ignores initial validation after editing while it is in flight", async () => {
		const request = deferred<{
			success: true;
			data: { valid: true; inviteCode: { organization: { name: string } } };
		}>();
		mocks.validateInviteCode.mockReturnValueOnce(request.promise);
		render(<JoinOrganizationForm code="OLD-CODE" />);
		const input = screen.getByLabelText("Invite Code");
		expect(input).toHaveProperty("disabled", false);
		fireEvent.change(input, { target: { value: "NEW-CODE" } });
		await act(async () => {
			request.resolve({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Stale Organization" } },
				},
			});
		});
		expect(screen.queryByText("Stale Organization")).toBeNull();
		expect(input).toHaveProperty("value", "NEW-CODE");
	});

	it.each(["pending", "approved"] as const)(
		"announces the server's %s result with a truthful continuation",
		async (status) => {
			mocks.session = {
				user: { id: "synthetic-user", email: "join@example.test" },
				session: { activeOrganizationId: "another-org" },
			};
			mocks.validateInviteCode.mockResolvedValue({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Joining Organization" } },
				},
			});
			mocks.redeemInviteCode.mockResolvedValue({
				success: true,
				data: { status, organizationName: "Joining Organization" },
			});
			render(<JoinOrganizationForm code="JOIN-CODE" />);
			await screen.findByText("Joining with join@example.test");
			await screen.findByText("Joining Organization");
			fireEvent.submit(joinForm());
			expect(
				await screen.findByRole("heading", {
					level: 1,
					name:
						status === "pending" ? "Join Request Sent" : "Joined Successfully",
				}),
			).toBeTruthy();
			expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
			expect(
				screen
					.getByRole("link", {
						name:
							status === "pending"
								? "Continue to your account"
								: "Go to Dashboard",
					})
					.getAttribute("href"),
			).toBe("/");
			expect(
				screen.queryByText(
					"Continuing does not approve this request or grant access to this organization.",
				) !== null,
			).toBe(status === "pending");
		},
	);

	it("prevents duplicate pending joins and retains input for a safe retry after transport failure", async () => {
		mocks.session = {
			user: { id: "synthetic-user", email: "join@example.test" },
			session: { activeOrganizationId: "another-org" },
		};
		mocks.validateInviteCode.mockResolvedValue({
			success: true,
			data: {
				valid: true,
				inviteCode: { organization: { name: "Joining Organization" } },
			},
		});
		const request = deferred<never>();
		mocks.redeemInviteCode
			.mockReturnValueOnce(request.promise)
			.mockResolvedValueOnce({
				success: false,
				error: "This code has been revoked",
			});
		render(<JoinOrganizationForm code="JOIN-CODE" />);
		await screen.findByText("Joining Organization");
		const form = joinForm();
		fireEvent.submit(form);
		fireEvent.submit(form);
		await waitFor(() =>
			expect(mocks.redeemInviteCode).toHaveBeenCalledTimes(1),
		);
		expect(screen.getByLabelText("Invite Code")).toHaveProperty(
			"disabled",
			true,
		);
		// Reject through the transport boundary, not a fabricated success handler.
		await act(async () => {
			request.reject(new Error("private network detail"));
		});
		expect(
			await screen.findByText(
				"Could not confirm your membership. Try again with the same code.",
			),
		).toBeTruthy();
		expect(screen.queryByText("private network detail")).toBeNull();
		expect(screen.getByLabelText("Invite Code")).toHaveProperty(
			"value",
			"JOIN-CODE",
		);
		fireEvent.submit(form);
		expect(await screen.findByText("This code has been revoked")).toBeTruthy();
	});

	it("preserves the locale and safely encodes continuation and sign-up code", async () => {
		mocks.locale = "de";
		mocks.validateInviteCode.mockResolvedValue({
			success: true,
			data: {
				valid: true,
				inviteCode: { organization: { name: "Organization" } },
			},
		});
		render(<JoinOrganizationForm code="JOIN-CODE" />);
		await screen.findByText("Organization");
		expect(
			screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
		).toBe("/sign-in?callbackUrl=%2Fde%2Fjoin%2FJOIN-CODE");
		expect(
			screen.getByRole("link", { name: "Sign up" }).getAttribute("href"),
		).toBe("/sign-up?inviteCode=JOIN-CODE");
	});

	it.each(["account", "organization"])(
		"does not present a late result in a changed %s scope",
		async (scope) => {
			mocks.session = {
				user: { id: "synthetic-user", email: "join@example.test" },
				session: { activeOrganizationId: "another-org" },
			};
			mocks.validateInviteCode.mockResolvedValue({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Joining Organization" } },
				},
			});
			const request = deferred<{
				success: true;
				data: { status: "approved"; organizationName: string };
			}>();
			mocks.redeemInviteCode.mockReturnValueOnce(request.promise);
			const { rerender } = render(<JoinOrganizationForm code="JOIN-CODE" />);
			await screen.findByText("Joining Organization");
			fireEvent.submit(joinForm());
			await waitFor(() =>
				expect(mocks.redeemInviteCode).toHaveBeenCalledTimes(1),
			);
			mocks.session = {
				user: {
					id: scope === "account" ? "new-user" : "synthetic-user",
					email: "join@example.test",
				},
				session: { activeOrganizationId: "new-org" },
			};
			rerender(<JoinOrganizationForm code="JOIN-CODE" />);
			await act(async () => {
				request.resolve({
					success: true,
					data: { status: "approved", organizationName: "Old Result" },
				});
			});
			expect(screen.queryByText("Old Result")).toBeNull();
			expect(
				screen.queryByRole("heading", { name: "Joined Successfully" }),
			).toBeNull();
		},
	);

	it("lets a visitor edit and revalidate a URL code before signing in", async () => {
		mocks.validateInviteCode.mockResolvedValue({
			success: true,
			data: {
				valid: true,
				inviteCode: { organization: { name: "Organization A" } },
			},
		});
		render(<JoinOrganizationForm code="CODE-A" />);
		await screen.findByText("Organization A");
		fireEvent.change(screen.getByLabelText("Invite Code"), {
			target: { value: "code-b" },
		});
		expect(screen.queryByText("Organization A")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Sign in to Join" }),
		).toHaveProperty("disabled", true);
		fireEvent.click(screen.getByRole("button", { name: "Validate" }));
		await screen.findByText("Organization A");
		fireEvent.click(screen.getByRole("button", { name: "Sign in to Join" }));
		expect(mocks.validateInviteCode).toHaveBeenLastCalledWith("CODE-B");
		await waitFor(() =>
			expect(mocks.push).toHaveBeenCalledWith(
				"/sign-in?callbackUrl=%2Fen%2Fjoin%2FCODE-B",
			),
		);
	});

	it("keeps a live initial-code validation during StrictMode replay", async () => {
		mocks.validateInviteCode.mockResolvedValue({
			success: true,
			data: {
				valid: true,
				inviteCode: { organization: { name: "Strict Organization" } },
			},
		});

		render(
			<StrictMode>
				<JoinOrganizationForm code="STRICT-CODE" />
			</StrictMode>,
		);

		expect(await screen.findByText("Strict Organization")).toBeTruthy();
		expect(mocks.validateInviteCode.mock.calls.length).toBeGreaterThanOrEqual(
			2,
		);
	});

	it("validates a changed URL code and does not let stale validation win", async () => {
		const first = deferred<{
			success: true;
			data: { valid: true; inviteCode: { organization: { name: string } } };
		}>();
		const second = deferred<{
			success: true;
			data: { valid: true; inviteCode: { organization: { name: string } } };
		}>();
		mocks.validateInviteCode
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);

		const { rerender } = render(<JoinOrganizationForm code="CODE-A" />);
		await waitFor(() =>
			expect(mocks.validateInviteCode).toHaveBeenCalledWith("CODE-A"),
		);

		rerender(<JoinOrganizationForm code="CODE-B" />);
		await waitFor(() =>
			expect(mocks.validateInviteCode).toHaveBeenCalledWith("CODE-B"),
		);
		expect(screen.getByLabelText("Invite Code")).toHaveProperty(
			"value",
			"CODE-B",
		);

		await act(async () => {
			second.resolve({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Organization B" } },
				},
			});
			await second.promise;
		});
		expect(await screen.findByText("Organization B")).toBeTruthy();

		await act(async () => {
			first.resolve({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Organization A" } },
				},
			});
			await first.promise;
		});

		expect(screen.getByText("Organization B")).toBeTruthy();
		expect(screen.queryByText("Organization A")).toBeNull();
	});

	it("settles initial validation with a safe error when the action rejects", async () => {
		mocks.validateInviteCode.mockRejectedValueOnce(
			new Error("validation service internals"),
		);

		render(<JoinOrganizationForm code="REJECTED-CODE" />);

		expect(await screen.findByText("Invalid invite code")).toBeTruthy();
		expect(screen.queryByText("Validating code...")).toBeNull();
		expect(screen.queryByText("validation service internals")).toBeNull();
	});

	it("ignores a manual validation result after the code changes", async () => {
		const request = deferred<{
			success: true;
			data: { valid: true; inviteCode: { organization: { name: string } } };
		}>();
		mocks.validateInviteCode.mockReturnValueOnce(request.promise);
		render(<JoinOrganizationForm />);

		fireEvent.change(screen.getByLabelText("Invite Code"), {
			target: { value: "CODE-A" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Validate" }));
		await waitFor(() =>
			expect(mocks.validateInviteCode).toHaveBeenCalledWith("CODE-A"),
		);
		fireEvent.change(screen.getByLabelText("Invite Code"), {
			target: { value: "CODE-B" },
		});

		await act(async () => {
			request.resolve({
				success: true,
				data: {
					valid: true,
					inviteCode: { organization: { name: "Organization A" } },
				},
			});
			await request.promise;
		});

		expect(screen.getByLabelText("Invite Code")).toHaveProperty(
			"value",
			"CODE-B",
		);
		expect(screen.queryByText("Organization A")).toBeNull();
		expect(screen.getByRole("button", { name: "Validate" })).toHaveProperty(
			"disabled",
			false,
		);
		expect(screen.queryByText("Validating code...")).toBeNull();
	});

	it("recovers from a rejected manual validation", async () => {
		mocks.validateInviteCode.mockRejectedValueOnce(
			new Error("validation service internals"),
		);
		render(<JoinOrganizationForm />);

		fireEvent.change(screen.getByLabelText("Invite Code"), {
			target: { value: "REJECTED-CODE" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Validate" }));

		expect(await screen.findByText("Invalid invite code")).toBeTruthy();
		expect(screen.queryByText("validation service internals")).toBeNull();
		expect(screen.getByRole("button", { name: "Validate" })).toHaveProperty(
			"disabled",
			false,
		);
	});
});
