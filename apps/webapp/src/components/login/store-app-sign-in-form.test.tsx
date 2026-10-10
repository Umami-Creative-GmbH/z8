/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	signInFromStoreApp: vi.fn(),
	loadNativeAuthSession: vi.fn(),
	getStoreAppPlatform: vi.fn(),
	searchParams: new URLSearchParams(),
	assign: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.searchParams }));
vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/lib/store-app/store-app-sign-in", () => ({
	signInFromStoreApp: mocks.signInFromStoreApp,
}));
vi.mock("@/lib/store-app/native-auth-session", () => ({
	loadNativeAuthSession: mocks.loadNativeAuthSession,
}));
vi.mock("@/lib/store-app/shell", () => ({ getStoreAppPlatform: mocks.getStoreAppPlatform }));

import { StoreAppSignInForm } from "./store-app-sign-in-form";

function submit(email: string) {
	fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("store app email screen", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.searchParams = new URLSearchParams();
		mocks.getStoreAppPlatform.mockReturnValue("ios");
		mocks.loadNativeAuthSession.mockResolvedValue(vi.fn());
		vi.stubGlobal("location", { href: "https://ui.example.test/en/sign-in", assign: mocks.assign });
	});
	afterEach(() => vi.unstubAllGlobals());

	it("signs in with the entered work email and loads the app signed in", async () => {
		mocks.signInFromStoreApp.mockResolvedValue({ status: "signed-in" });
		mocks.searchParams = new URLSearchParams({ callbackUrl: "/time-tracking" });
		render(<StoreAppSignInForm />);

		submit("  ada@acme.example ");

		await waitFor(() => expect(mocks.assign).toHaveBeenCalledOnce());
		expect(mocks.loadNativeAuthSession).toHaveBeenCalledWith("ios");
		expect(mocks.signInFromStoreApp.mock.calls[0]?.[0]).toBe("ada@acme.example");
		expect(mocks.assign).toHaveBeenCalledWith("/init?callbackUrl=%2Ftime-tracking");
	});

	it("does not start sign-in for an invalid email", async () => {
		const { container } = render(<StoreAppSignInForm />);

		// Past the browser's own type="email" check, which blocks a click submit.
		fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@" } });
		fireEvent.submit(container.querySelector("form") as HTMLFormElement);

		expect(await screen.findByText("Invalid email address")).toBeTruthy();
		expect(mocks.signInFromStoreApp).not.toHaveBeenCalled();
	});

	it("explains an expired sign-in and lets the user try again", async () => {
		mocks.signInFromStoreApp.mockResolvedValue({ status: "failed", reason: "exchange" });
		render(<StoreAppSignInForm />);

		submit("ada@acme.example");

		expect(
			await screen.findByText("Sign-in did not complete or has expired. Please try again."),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false);
		expect(mocks.assign).not.toHaveBeenCalled();
	});

	it("returns quietly to the email screen when the user cancels", async () => {
		mocks.signInFromStoreApp.mockResolvedValue({ status: "cancelled" });
		render(<StoreAppSignInForm />);

		submit("ada@acme.example");

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty("disabled", false),
		);
		expect(screen.queryByRole("alert")).toBeNull();
	});
});
