/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	exportPublicKeyActionMock,
	getSigningKeyHistoryActionMock,
	refreshMock,
	rotateSigningKeyActionMock,
} = vi.hoisted(() => ({
	exportPublicKeyActionMock: vi.fn(),
	getSigningKeyHistoryActionMock: vi.fn(),
	refreshMock: vi.fn(),
	rotateSigningKeyActionMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/audit-export/actions", () => ({
	exportPublicKeyAction: exportPublicKeyActionMock,
	getSigningKeyHistoryAction: getSigningKeyHistoryActionMock,
	rotateSigningKeyAction: rotateSigningKeyActionMock,
}));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

function Wrapper({ children }: { children?: ReactNode }) {
	return <div>{children}</div>;
}

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: Wrapper,
	ActionPanelBody: Wrapper,
	ActionPanelContent: Wrapper,
	ActionPanelDescription: Wrapper,
	ActionPanelHeader: Wrapper,
	ActionPanelTitle: Wrapper,
	ActionPanelTrigger: Wrapper,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
	AlertDialog: Wrapper,
	AlertDialogAction: (props: ComponentProps<"button">) => <button {...props} />,
	AlertDialogCancel: (props: ComponentProps<"button">) => <button {...props} />,
	AlertDialogContent: Wrapper,
	AlertDialogDescription: Wrapper,
	AlertDialogFooter: Wrapper,
	AlertDialogHeader: Wrapper,
	AlertDialogTitle: Wrapper,
	AlertDialogTrigger: Wrapper,
}));

import { KeyManagement } from "./key-management";

const publicKey = {
	publicKeyPem:
		"-----BEGIN PUBLIC KEY-----\npublic-material\n-----END PUBLIC KEY-----",
	fingerprint: "fingerprint",
	algorithm: "Ed25519",
	version: 2,
};

describe("KeyManagement", () => {
	beforeEach(() => {
		exportPublicKeyActionMock.mockReset();
		getSigningKeyHistoryActionMock.mockReset();
		rotateSigningKeyActionMock.mockReset();
		refreshMock.mockReset();
		vi.mocked(toast.error).mockClear();
		vi.mocked(toast.success).mockClear();
		exportPublicKeyActionMock.mockResolvedValue({
			success: true,
			data: publicKey,
		});
		getSigningKeyHistoryActionMock.mockResolvedValue({
			success: true,
			data: [],
		});
		rotateSigningKeyActionMock.mockResolvedValue({
			success: true,
			data: { fingerprint: "new-fingerprint", version: 3 },
		});
	});

	it("clears every busy state and reports rejected key operations", async () => {
		const error = new Error("Network failed");
		exportPublicKeyActionMock.mockRejectedValue(error);
		getSigningKeyHistoryActionMock.mockRejectedValue(error);
		rotateSigningKeyActionMock.mockRejectedValue(error);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		render(
			<KeyManagement
				organizationId="org-1"
				activeKeyFingerprint="active-fingerprint"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Export Public Key" }));
		await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
		expect(screen.getByText("No key data available")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Key History" }));
		await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
		expect(screen.getByText("No key history available")).toBeTruthy();
		const rotateConfirm = screen.getAllByRole("button", {
			name: "Rotate Key",
		})[1];
		fireEvent.click(rotateConfirm);

		await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(3));
		expect(rotateConfirm).toHaveProperty("disabled", false);
		expect(toast.error).toHaveBeenCalledTimes(3);
		expect(refreshMock).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith(
			"Export public key error:",
			error,
		);
		expect(console.error).toHaveBeenCalledWith(
			"Load key history error:",
			error,
		);
		expect(console.error).toHaveBeenCalledWith("Rotate key error:", error);
	});

	it("copies and downloads only the exported public key and refreshes after rotation", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const createObjectURL = vi.fn().mockReturnValue("blob:public-key");
		const revokeObjectURL = vi.fn();
		Object.defineProperties(URL, {
			createObjectURL: { configurable: true, value: createObjectURL },
			revokeObjectURL: { configurable: true, value: revokeObjectURL },
		});
		const anchorClick = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => undefined);
		render(
			<KeyManagement
				organizationId="org-1"
				activeKeyFingerprint="active-fingerprint"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Export Public Key" }));
		await waitFor(() =>
			expect(exportPublicKeyActionMock).toHaveBeenCalledWith("org-1"),
		);
		const publicKeyTextarea = await screen.findByRole("textbox");
		expect(publicKeyTextarea).toHaveProperty("value", publicKey.publicKeyPem);
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		fireEvent.click(screen.getByRole("button", { name: "Download" }));
		fireEvent.click(screen.getAllByRole("button", { name: "Rotate Key" })[1]);

		await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce());
		expect(writeText).toHaveBeenCalledWith(publicKey.publicKeyPem);
		expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
		expect(anchorClick).toHaveBeenCalledOnce();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:public-key");
	});

	it("reports clipboard failure and does not claim success", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		render(
			<KeyManagement
				organizationId="org-1"
				activeKeyFingerprint="active-fingerprint"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Export Public Key" }));
		await screen.findByRole("textbox");
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith("Failed to copy public key"),
		);
		expect(toast.success).not.toHaveBeenCalledWith(
			"Public key copied to clipboard",
		);
	});

	it("discards public key results from the previous organization", async () => {
		let resolveOrgOne: ((value: unknown) => void) | undefined;
		exportPublicKeyActionMock
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveOrgOne = resolve;
					}),
			)
			.mockResolvedValueOnce({
				success: true,
				data: { ...publicKey, publicKeyPem: "org-2-public-key" },
			});
		const { rerender } = render(
			<KeyManagement
				organizationId="org-1"
				activeKeyFingerprint="org-1-fingerprint"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Export Public Key" }));
		rerender(
			<KeyManagement
				organizationId="org-2"
				activeKeyFingerprint="org-2-fingerprint"
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Export Public Key" }));
		expect(await screen.findByDisplayValue("org-2-public-key")).toBeTruthy();

		resolveOrgOne?.({ success: true, data: publicKey });
		await waitFor(() =>
			expect(exportPublicKeyActionMock).toHaveBeenCalledWith("org-2"),
		);
		expect(screen.queryByDisplayValue(publicKey.publicKeyPem)).toBeNull();
	});
});
