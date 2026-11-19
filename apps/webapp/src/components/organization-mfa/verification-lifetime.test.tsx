// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { verifyTotp, social } = vi.hoisted(() => ({
	verifyTotp: vi.fn(),
	social: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/auth-client", () => ({
	authClient: { twoFactor: { verifyTotp }, signIn: { social } },
}));

import { MfaVerification } from "./verification";

let navigation: { href: string; pathname: string; search: string };
beforeEach(() => {
	navigation = {
		href: "https://z8.test/en/mfa?organizationId=A",
		pathname: "/en/mfa",
		search: "?organizationId=A",
	};
	const browserWindow = window;
	vi.stubGlobal(
		"window",
		new Proxy(browserWindow, {
			get(target, key) {
				return key === "location"
					? navigation
					: Reflect.get(target, key, target);
			},
		}),
	);
	verifyTotp.mockReset();
	social.mockReset();
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((finish) => {
		resolve = finish;
	});
	return { promise, resolve };
}
async function submitCode() {
	const input = screen.getByLabelText("Authenticator code");
	fireEvent.change(input, { target: { value: "123456" } });
	const form = input.closest("form");
	if (!form) throw new Error("Missing authenticator form");
	fireEvent.submit(form);
	await waitFor(() => expect(verifyTotp).toHaveBeenCalledTimes(1));
}

it("keeps the new organization when an earlier organization's SSO response arrives", async () => {
	const request = deferred<Response>();
	const fetcher = vi.fn(() => request.promise);
	vi.stubGlobal("fetch", fetcher);
	const view = render(
		<MfaVerification
			key="user:A"
			organizationId="A"
			hasPassword
			socialProviders={[]}
		/>,
	);
	fireEvent.click(screen.getByText("Verify an existing sign-in"));
	fireEvent.click(
		screen.getByRole("button", { name: "Verify with organization SSO" }),
	);
	await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
	view.rerender(
		<MfaVerification
			key="user:B"
			organizationId="B"
			hasPassword
			socialProviders={[]}
		/>,
	);
	navigation.href = "https://z8.test/en/mfa?organizationId=B";
	await act(async () =>
		request.resolve(Response.json({ url: "https://idp.test/old-A" })),
	);
	expect(navigation.href).toBe("https://z8.test/en/mfa?organizationId=B");
});

it("keeps the new organization after an earlier authenticator succeeds", async () => {
	const request = deferred<unknown>();
	verifyTotp.mockReturnValue(request.promise);
	const view = render(
		<MfaVerification
			key="user:A"
			organizationId="A"
			hasPassword
			socialProviders={[]}
		/>,
	);
	await submitCode();
	view.rerender(
		<MfaVerification
			key="user:B"
			organizationId="B"
			hasPassword
			socialProviders={[]}
		/>,
	);
	navigation.href = "https://z8.test/en/mfa?organizationId=B";
	await act(async () => request.resolve({ data: { status: true } }));
	expect(navigation.href).toBe("https://z8.test/en/mfa?organizationId=B");
});

it("requires a new action after returning to a cached organization with an older verification pending", async () => {
	const request = deferred<unknown>();
	verifyTotp.mockReturnValue(request.promise);
	const page = (visible: boolean) => (
		<Activity mode={visible ? "visible" : "hidden"}>
			<MfaVerification organizationId="A" hasPassword socialProviders={[]} />
		</Activity>
	);
	const view = render(page(true));
	await submitCode();
	view.rerender(page(false));
	navigation.href = "https://z8.test/en/mfa?organizationId=B";
	await act(async () => {});
	view.rerender(page(true));
	navigation.href = "https://z8.test/en/mfa?organizationId=A";
	await act(async () => {});
	await act(async () => request.resolve({ data: { status: true } }));
	expect(navigation.href).toBe("https://z8.test/en/mfa?organizationId=A");
});

it.each([true, false])(
	"follows the social provider only for the requesting arrival (current=%s)",
	async (current) => {
		const request = deferred<unknown>();
		social.mockReturnValue(request.promise);
		const page = (visible: boolean) => (
			<Activity mode={visible ? "visible" : "hidden"}>
				<MfaVerification
					organizationId="A"
					hasPassword
					socialProviders={["google"]}
				/>
			</Activity>
		);
		const view = render(page(true));
		fireEvent.click(screen.getByText("Verify an existing sign-in"));
		fireEvent.click(
			screen.getByRole("button", {
				name: "Verify existing sign-in with {provider}",
			}),
		);
		await waitFor(() => expect(social).toHaveBeenCalledTimes(1));
		// Keep Better Auth's automatic redirect from running before the arrival guard.
		expect(social).toHaveBeenCalledWith({
			provider: "google",
			callbackURL: navigation.href,
			disableRedirect: true,
		});
		if (!current) {
			view.rerender(page(false));
			await act(async () => {});
			view.rerender(page(true));
			await act(async () => {});
		}
		await act(async () =>
			request.resolve({
				data: { url: "https://idp.test/authorize", redirect: false },
			}),
		);
		expect(navigation.href).toBe(
			current
				? "https://idp.test/authorize"
				: "https://z8.test/en/mfa?organizationId=A",
		);
	},
);

it("allows fresh verification on return and keeps it pending when an older response settles", async () => {
	const oldRequest = deferred<unknown>();
	const currentRequest = deferred<unknown>();
	verifyTotp
		.mockReturnValueOnce(oldRequest.promise)
		.mockReturnValueOnce(currentRequest.promise);
	const page = (visible: boolean) => (
		<Activity mode={visible ? "visible" : "hidden"}>
			<MfaVerification organizationId="A" hasPassword socialProviders={[]} />
		</Activity>
	);
	const view = render(page(true));
	await submitCode();
	view.rerender(page(false));
	await act(async () => {});
	view.rerender(page(true));
	await act(async () => {});
	const input = screen.getByLabelText<HTMLInputElement>("Authenticator code");
	fireEvent.change(input, { target: { value: "654321" } });
	fireEvent.click(screen.getByRole("button", { name: "Verify authenticator" }));
	await waitFor(() => expect(verifyTotp).toHaveBeenCalledTimes(2));
	await act(async () =>
		oldRequest.resolve({ error: { message: "Old arrival refused" } }),
	);
	expect(screen.queryByText("Old arrival refused")).toBeNull();
	expect(
		screen.getByRole<HTMLButtonElement>("button", {
			name: "Verify authenticator",
		}).disabled,
	).toBe(true);
	expect(input.value).toBe("654321");
	expect(navigation.href).toBe("https://z8.test/en/mfa?organizationId=A");
	await act(async () => currentRequest.resolve({ data: { status: true } }));
	expect(navigation.href).toBe("/init?organizationId=A");
});
