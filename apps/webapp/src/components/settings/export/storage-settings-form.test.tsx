/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

let refreshHandler: (() => unknown) | undefined;
vi.mock("@/components/providers/view-refresh-provider", () => ({
	useViewRefresh: (handler: () => unknown) => { refreshHandler = handler; },
}));

const { deleteMock, saveMock, getMock } = vi.hoisted(() => ({
	getMock: vi.fn(),
	deleteMock: vi.fn(),
	saveMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en",
		timezone: "UTC",
		timeFormat: "24h",
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/export/actions", () => ({
	deleteStorageConfigAction: deleteMock,
	getStorageConfigAction: getMock,
	saveStorageConfigAction: saveMock,
	testStorageConnectionAction: vi.fn(),
}));

function Wrapper({ children }: { children?: ReactNode }) {
	return <div>{children}</div>;
}
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

import { StorageSettingsForm } from "./storage-settings-form";

const existingConfig = {
	id: "storage-1",
	bucket: "existing-bucket",
	region: "eu-central-1",
	endpoint: null,
	isVerified: true,
	lastVerifiedAt: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("StorageSettingsForm", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("omits blank credentials when saving an existing configuration", async () => {
		saveMock.mockResolvedValue({ success: true, data: existingConfig });
		const onConfigChange = vi.fn();
		render(
			<StorageSettingsForm
				organizationId="org-1"
				onConfigChange={onConfigChange}
				initialConfig={existingConfig}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

		await waitFor(() => expect(saveMock).toHaveBeenCalledOnce());
		await waitFor(() => expect(onConfigChange).toHaveBeenCalledWith(true));
		expect(toast.success).toHaveBeenCalledWith("Configuration saved", expect.any(Object));
		expect(saveMock.mock.calls[0]?.[0]).toEqual({
			organizationId: "org-1",
			bucket: "existing-bucket",
			region: "eu-central-1",
			endpoint: undefined,
		});
	});

	it("recovers from rejected save and delete operations with error toasts", async () => {
		saveMock.mockRejectedValue(new Error("save rejected"));
		deleteMock.mockRejectedValue(new Error("delete rejected"));
		render(
			<StorageSettingsForm
				organizationId="org-1"
				initialConfig={existingConfig}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith("Failed to save configuration"),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Save Configuration" }),
			).toHaveProperty("disabled", false),
		);

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Failed to delete configuration",
			),
		);
		expect(screen.getByDisplayValue("existing-bucket")).toBeTruthy();
	});
	it("accepts fresh untouched config after mount loading and preserves credential drafts", async () => {
		getMock.mockResolvedValue({ success: true, data: existingConfig });
		render(<StorageSettingsForm organizationId="org-1" />);
		await screen.findByDisplayValue("existing-bucket");
		getMock.mockResolvedValue({ success: true, data: { ...existingConfig, bucket: "fresh-bucket" } });
		await act(async () => {
			await refreshHandler?.();
		});
		expect(screen.getByDisplayValue("fresh-bucket")).toBeTruthy();
		fireEvent.change(screen.getByLabelText(/Secret Access Key/), {
			target: { value: "unsaved-secret" },
		});
		getMock.mockResolvedValue({ success: true, data: { ...existingConfig, bucket: "newer-bucket" } });
		await act(async () => {
			await refreshHandler?.();
		});
		expect(screen.getByDisplayValue("fresh-bucket")).toBeTruthy();
		expect(screen.getByLabelText(/Secret Access Key/)).toHaveProperty("value", "unsaved-secret");
	});
});
