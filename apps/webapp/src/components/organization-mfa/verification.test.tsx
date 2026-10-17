// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/lib/auth-client", () => ({
	authClient: {
		twoFactor: { verifyBackupCode: async () => ({ data: { status: true } }) },
	},
}));

import { MfaVerification } from "./verification";

it("keeps backup-code recovery on the replacement-enrollment page", async () => {
	render(
		<MfaVerification organizationId="org" hasPassword socialProviders={[]} />,
	);
	await userEvent.type(screen.getByLabelText("Backup code"), "backup-code");
	await userEvent.click(
		screen.getByRole("button", { name: "Recover with backup code" }),
	);
	expect(
		await screen.findByText(
			"Recovery permits replacement enrollment only. Verify an authenticator before returning to your organization.",
		),
	).toBeTruthy();
});
