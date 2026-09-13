/* @vitest-environment jsdom */

import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InitPage from "./page-client";

const translateMock = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ params: new URLSearchParams(), activate: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("@/lib/enterprise-identity/organization-activation", () => ({ activateOrganization: state.activate }));
vi.mock("@/lib/org-persistence", () => ({ getLastOrganization: () => "locked", saveLastOrganization: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: translateMock }),
}));

describe("InitPage", () => {
	afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
	beforeEach(() => {
		state.params = new URLSearchParams(); state.activate.mockReset();
		translateMock.mockImplementation(
			(_key: string, fallback: string) => fallback,
		);
	});

	it("keeps the organization picker available after IdP failure instead of auto-reauthenticating", async () => {
		state.params = new URLSearchParams("ssoError=1&organizationId=locked");
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hasActiveOrganization: false, organizations: [{ id: "locked", name: "Locked" }, { id: "open", name: "Open" }] })));
		render(<InitPage />);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("Open")).toBeTruthy();
		expect(state.activate).not.toHaveBeenCalled();
	});

	it("surfaces activation failures without navigating back into the app loop", async () => {
		state.activate.mockRejectedValue(new Error("SSO sign-in could not be started"));
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hasActiveOrganization: false, organizations: [{ id: "locked", name: "Locked" }, { id: "open", name: "Open" }] })));
		render(<InitPage />);
		await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("SSO sign-in could not be started"));
		expect(screen.getByText("Open")).toBeTruthy();
	});

	it("honors the SSO return organization before an existing active org and prevents automatic restart", async () => {
		state.params = new URLSearchParams("organizationId=locked&ssoAttempt=1");
		state.activate.mockRejectedValue(new Error("SSO sign-in did not grant access"));
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ hasActiveOrganization: true, activeOrganizationId: "open", organizations: [{ id: "locked", name: "Locked" }, { id: "open", name: "Open" }] })));
		render(<InitPage />);
		await screen.findByRole("alert");
		expect(state.activate).toHaveBeenCalledWith("locked", "/", expect.any(Function), false);
	});

	it("provides a centered accessible workspace progress state", () => {
		translateMock.mockImplementation((key: string, fallback: string) =>
			key === "setup:init.checking"
				? "Arbeitsbereich wird initialisiert"
				: fallback,
		);
		const page = InitPage();
		if (!isValidElement<{ fallback: React.ReactNode }>(page)) {
			throw new Error("Expected InitPage to return a React element");
		}

		render(page.props.fallback);

		expect(
			screen.getByRole("status", { name: "Arbeitsbereich wird initialisiert" }),
		).toBeTruthy();
		expect(screen.getByText("Arbeitsbereich wird initialisiert")).toBeTruthy();
		expect(translateMock).toHaveBeenCalledWith(
			"setup:init.checking",
			"Checking session...",
		);
		const loadingClassName = screen.getByTestId("init-page-loading").className;
		expect(loadingClassName).toContain("min-h-screen");
		expect(loadingClassName).toContain("items-center");
		expect(loadingClassName).toContain("justify-center");
	});
});
