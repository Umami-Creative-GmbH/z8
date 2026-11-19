/* @vitest-environment jsdom */

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InitPage from "./page-client";

const state = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const organizations = [
	{ id: "locked", name: "Locked" },
	{ id: "open", name: "Open" },
];
const request = vi.fn<typeof fetch>();
const navigate = vi.fn();

function session(orgs = organizations, hasActiveOrganization = false) {
	return Response.json({ hasActiveOrganization, organizations: orgs });
}

describe("InitPage", () => {
	beforeEach(() => {
		state.params = new URLSearchParams();
		localStorage.clear();
		request.mockReset();
		navigate.mockReset();
		vi.stubGlobal("fetch", request);
		vi.stubGlobal("location", {
			href: "https://z8.test/en/init",
			assign: navigate,
		});
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("keeps the organization picker available after IdP failure instead of auto-reauthenticating", async () => {
		localStorage.setItem("z8-last-organization-id", "locked");
		state.params = new URLSearchParams("ssoError=1&organizationId=locked");
		request.mockResolvedValue(session());
		render(<InitPage />);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByRole("button", { name: /Open/ })).toBeTruthy();
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("surfaces activation failures beside the retained choices", async () => {
		localStorage.setItem("z8-last-organization-id", "locked");
		request
			.mockResolvedValueOnce(session())
			.mockResolvedValueOnce(
				Response.json({ error: "Access denied" }, { status: 403 }),
			);
		render(<InitPage />);
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Access denied",
		);
		expect(screen.getByRole("button", { name: /Open/ })).toBeTruthy();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("honors the SSO return organization before an existing active org without restarting SSO", async () => {
		state.params = new URLSearchParams("organizationId=locked&ssoAttempt=1");
		request
			.mockResolvedValueOnce(session(organizations, true))
			.mockResolvedValueOnce(
				Response.json({ code: "SSO_REQUIRED" }, { status: 403 }),
			);
		render(<InitPage />);
		expect((await screen.findByRole("alert")).textContent).toContain(
			"SSO sign-in did not grant access",
		);
		expect(request).toHaveBeenLastCalledWith(
			"/api/organizations/switch",
			expect.objectContaining({ body: '{"organizationId":"locked"}' }),
		);
		expect(request).toHaveBeenCalledTimes(2);
		expect(navigate).not.toHaveBeenCalled();
	});

	it("retains disabled choices and announces activation while preventing repeated keyboard and click submissions", async () => {
		let finish: (response: Response) => void = () => {
			throw new Error("Request not pending");
		};
		request.mockResolvedValueOnce(session()).mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					finish = resolve;
				}),
		);
		render(<InitPage />);
		const locked = await screen.findByRole("button", { name: /Locked/ });
		locked.focus();
		await userEvent.keyboard("{Enter}");
		expect(
			screen.getByRole("button", { name: /Open/ }).hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByRole("status").textContent).toContain(
			"Setting up your workspace",
		);
		expect(screen.getByRole("status").textContent).toContain("Locked");
		fireEvent.click(locked);
		await userEvent.keyboard(" ");
		expect(request).toHaveBeenCalledTimes(2);
		await act(async () =>
			finish(
				Response.json(
					{ error: "Access changed. Choose another organization." },
					{ status: 403 },
				),
			),
		);
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Access changed",
		);
		await waitFor(() => expect(document.activeElement).toBe(locked));
		expect(
			screen.getByRole("button", { name: /Open/ }).hasAttribute("disabled"),
		).toBe(false);
		expect(localStorage.getItem("z8-last-organization-id")).toBeNull();
	});

	it("recovers a failed session check in place without navigating into an init loop", async () => {
		request.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		render(<InitPage />);
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Try again",
		);
		expect(navigate).not.toHaveBeenCalled();
		request.mockResolvedValueOnce(session());
		await userEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(await screen.findByRole("button", { name: /Open/ })).toBeTruthy();
	});

	it.each([
		["valid last organization", "open", organizations, "open"],
		[
			"only available organization despite stale preference",
			"removed",
			[organizations[0]],
			"locked",
		],
	])(
		"automatically activates the %s and persists it only after success",
		async (_label, saved, orgs, expected) => {
			localStorage.setItem("z8-last-organization-id", saved);
			state.params = new URLSearchParams({
				callbackUrl: "/reports?period=week#totals",
			});
			request
				.mockResolvedValueOnce(session(orgs))
				.mockResolvedValueOnce(Response.json({ hasEmployeeRecord: false }));
			render(<InitPage />);
			await waitFor(() =>
				expect(navigate).toHaveBeenCalledWith("/reports?period=week#totals"),
			);
			expect(request).toHaveBeenLastCalledWith(
				"/api/organizations/switch",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ organizationId: expected }),
				}),
			);
			expect(localStorage.getItem("z8-last-organization-id")).toBe(expected);
			expect(screen.getByRole("status").textContent).toContain("Redirecting");
		},
	);

	it.each([
		["existing active organization", organizations, true],
		["no organizations", [], false],
	])(
		"continues the %s flow without activating an organization",
		async (_label, orgs, active) => {
			state.params = new URLSearchParams({ callbackUrl: "/time-tracking" });
			request.mockResolvedValueOnce(session(orgs, active));
			render(<InitPage />);
			await waitFor(() =>
				expect(navigate).toHaveBeenCalledWith("/time-tracking"),
			);
			expect(request).toHaveBeenCalledTimes(1);
			expect(localStorage.getItem("z8-last-organization-id")).toBeNull();
		},
	);

	it.each(["https://attacker.test/", "//attacker.test/", "/\\attacker.test/"])(
		"rejects unsafe callback %s",
		async (callbackUrl) => {
			state.params = new URLSearchParams({ callbackUrl });
			request.mockResolvedValueOnce(session([], false));
			render(<InitPage />);
			await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
		},
	);

	it("does not activate a requested or saved organization outside the authorized choices", async () => {
		state.params = new URLSearchParams("organizationId=not-a-member");
		localStorage.setItem("z8-last-organization-id", "removed");
		request.mockResolvedValueOnce(session());
		render(<InitPage />);
		expect(await screen.findByRole("button", { name: /Open/ })).toBeTruthy();
		expect(request).toHaveBeenCalledTimes(1);
	});

	it.each(["SSO_REQUIRED", "MFA_REQUIRED"])(
		"hands off %s without claiming activation or persisting a preference",
		async (code) => {
			state.params = new URLSearchParams({
				organizationId: "locked",
				callbackUrl: "/reports",
			});
			request
				.mockResolvedValueOnce(session())
				.mockResolvedValueOnce(Response.json({ code }, { status: 403 }));
			if (code === "SSO_REQUIRED")
				request.mockResolvedValueOnce(
					Response.json({ url: "https://idp.test/login" }),
				);
			render(<InitPage />);
			await waitFor(() =>
				expect(navigate).toHaveBeenCalledWith(
					code === "SSO_REQUIRED"
						? "https://idp.test/login"
						: "/mfa?organizationId=locked&callbackUrl=%2Freports",
				),
			);
			expect(localStorage.getItem("z8-last-organization-id")).toBeNull();
		},
	);

	it("allows Space to choose another organization after a refused selection", async () => {
		request
			.mockResolvedValueOnce(session())
			.mockResolvedValueOnce(
				Response.json({ error: "Membership revoked" }, { status: 403 }),
			)
			.mockResolvedValueOnce(Response.json({ hasEmployeeRecord: true }));
		render(<InitPage />);
		await userEvent.click(
			await screen.findByRole("button", { name: /Locked/ }),
		);
		await screen.findByRole("alert");
		screen.getByRole("button", { name: /Open/ }).focus();
		await userEvent.keyboard(" ");
		await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
		expect(localStorage.getItem("z8-last-organization-id")).toBe("open");
	});

	it("starts only one session check in Strict Mode", async () => {
		request.mockResolvedValueOnce(session());
		render(
			<StrictMode>
				<InitPage />
			</StrictMode>,
		);
		await screen.findByRole("button", { name: /Open/ });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it.each([401, 403])(
		"returns a %s session refusal to sign-in",
		async (status) => {
			request.mockResolvedValueOnce(
				Response.json({ error: "Unauthorized" }, { status }),
			);
			render(<InitPage />);
			await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sign-in"));
		},
	);

	it.each([
		Response.json({ error: "Unavailable" }, { status: 500 }),
		new Response("not JSON"),
	])(
		"retains recovery after a failed session response %#",
		async (response) => {
			request.mockResolvedValueOnce(response);
			render(<InitPage />);
			expect(
				await screen.findByRole("button", { name: "Try again" }),
			).toBeTruthy();
			expect(navigate).not.toHaveBeenCalled();
		},
	);

	it("does not navigate or replace preferences when activation completes after leaving init", async () => {
		let finish: (response: Response) => void = () => {
			throw new Error("Request not pending");
		};
		request
			.mockResolvedValueOnce(session([organizations[0]]))
			.mockImplementationOnce(
				() =>
					new Promise<Response>((resolve) => {
						finish = resolve;
					}),
			);
		const { unmount } = render(<InitPage />);
		await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
		unmount();
		await act(async () => finish(Response.json({ hasEmployeeRecord: true })));
		expect(navigate).not.toHaveBeenCalled();
		expect(localStorage.getItem("z8-last-organization-id")).toBeNull();
	});

	it("keeps every organization reachable by keyboard in a long list with long names", async () => {
		const orgs = Array.from({ length: 60 }, (_, index) => ({
			id: `org-${index}`,
			name: `Organization ${index} with a long translated display name`,
		}));
		request.mockResolvedValueOnce(session(orgs));
		render(<InitPage />);
		await screen.findByRole("list", { name: "Select Organization" });
		expect(screen.getAllByRole("button")).toHaveLength(60);
		screen.getAllByRole("button")[58].focus();
		await userEvent.tab();
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: orgs[59].name }),
		);
	});
});
