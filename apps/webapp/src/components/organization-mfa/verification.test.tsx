// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

const verifyTotp = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/auth-client", () => ({
	authClient: {
		twoFactor: {
			verifyTotp: (...args: unknown[]) => verifyTotp(...args),
			verifyBackupCode: async () => ({ data: { status: true } }),
		},
	},
}));

import { MfaVerification } from "./verification";

afterEach(() => vi.restoreAllMocks());

it("validates the authenticator form, focuses its field and submits Enter once while retaining a refused code", async () => {
	let finish!: (value: unknown) => void;
	verifyTotp.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	render(
		<MfaVerification organizationId="org" hasPassword socialProviders={[]} />,
	);
	const code = screen.getByLabelText<HTMLInputElement>("Authenticator code");
	for (const id of code.getAttribute("aria-describedby")?.split(" ") ?? []) {
		expect(document.getElementById(id)).toBeTruthy();
	}
	await userEvent.click(
		screen.getByRole("button", { name: "Verify authenticator" }),
	);
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Enter an authenticator code",
	);
	expect(document.activeElement).toBe(code);
	expect(verifyTotp).not.toHaveBeenCalled();
	await userEvent.type(code, "123456{Enter}");
	await waitFor(() => expect(verifyTotp).toHaveBeenCalledTimes(1));
	const nativeForm = code.closest("form");
	if (!nativeForm) throw new Error("Missing native verification form");
	fireEvent.submit(nativeForm);
	expect(verifyTotp).toHaveBeenCalledTimes(1);
	expect(
		screen.getByRole<HTMLButtonElement>("button", {
			name: "Continue after verification",
		}).disabled,
	).toBe(true);
	finish({
		error: { message: "Authenticator could not be verified. Try again." },
	});
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Authenticator could not be verified",
	);
	expect(code.value).toBe("123456");
	expect(
		screen.getByRole<HTMLButtonElement>("button", {
			name: "Verify authenticator",
		}).disabled,
	).toBe(false);
	await userEvent.click(
		screen.getByRole("button", { name: "Verify authenticator" }),
	);
	await waitFor(() => expect(verifyTotp).toHaveBeenCalledTimes(2));
	finish({ error: { message: "Still unavailable" } });
	await screen.findByText("Still unavailable");
});

it("retains social and passkey alternatives for an account without a password", async () => {
	render(
		<MfaVerification
			organizationId={null}
			hasPassword={false}
			socialProviders={["google", "github", "apple", "linkedin"]}
		/>,
	);
	expect(screen.queryByLabelText("Current password")).toBeNull();
	expect(screen.queryByText("Recover with a backup code")).toBeNull();
	expect(
		screen.getByRole("button", { name: "Verify with a passkey" }),
	).toBeTruthy();
	await userEvent.click(screen.getByText("Verify an existing sign-in"));
	expect(
		screen.getAllByRole("button", {
			name: "Verify existing sign-in with {provider}",
		}),
	).toHaveLength(4);
	expect(
		screen.queryByRole("button", { name: "Verify with organization SSO" }),
	).toBeNull();
});

it("keeps backup-code recovery on the replacement-enrollment page", async () => {
	render(
		<MfaVerification organizationId="org" hasPassword socialProviders={[]} />,
	);
	await userEvent.click(screen.getByText("Recover with a backup code"));
	await userEvent.type(screen.getByLabelText("Backup code"), "backup-code");
	await userEvent.click(
		screen.getByRole("button", { name: "Recover with backup code" }),
	);
	expect(
		await screen.findByText(/Recovery permits replacement enrollment only\./),
	).toBeTruthy();
	expect(screen.getByRole("status").textContent).toContain(
		"Verify your password again before verifying an authenticator.",
	);
});
