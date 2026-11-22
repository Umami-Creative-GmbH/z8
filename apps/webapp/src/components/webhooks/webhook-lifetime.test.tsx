// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createWebhook } from "@/app/[locale]/(app)/settings/enterprise/api-keys/webhook-actions";
import { render } from "@/test/render-with-translations";
import { WebhookFormDialog } from "./webhook-form-dialog";

vi.mock("@/app/[locale]/(app)/settings/enterprise/api-keys/webhook-actions", () => ({
	createWebhook: vi.fn(),
	updateWebhook: vi.fn(),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);
function Harness({ visible }: { visible: boolean }) {
	const [open, setOpen] = useState(true);
	return (
		<Activity mode={visible ? "visible" : "hidden"}>
			<WebhookFormDialog open={open} onOpenChange={setOpen} onSuccess={vi.fn()} />
		</Activity>
	);
}
it("retires a revealed webhook signing secret after Activity hides and reactivates its owner", async () => {
	vi.mocked(createWebhook).mockResolvedValue({
		success: true,
		data: {
			endpoint: { id: "public-endpoint", name: "Fixture", url: "https://example.com/fixture" },
			secret: "public-test-dummy-signing-secret",
		},
	} as Awaited<ReturnType<typeof createWebhook>>);
	const view = render(<Harness visible />);
	const user = userEvent.setup();
	await user.type(screen.getByRole("textbox", { name: "Name" }), "Fixture");
	await user.type(
		screen.getByRole("textbox", { name: "Endpoint URL" }),
		"https://example.com/fixture",
	);
	await user.click(screen.getByRole("checkbox", { name: "absence_request_approved" }));
	fireEvent.submit(
		screen.getByRole("button", { name: "Create Webhook", exact: true }).closest("form")!,
	);
	expect(await screen.findByRole("dialog", { name: "Webhook Secret" })).toBeTruthy();
	await act(async () => view.rerender(<Harness visible={false} />));
	await act(async () => view.rerender(<Harness visible />));
	expect(screen.queryByRole("dialog", { name: "Webhook Secret" })).toBeNull();
});
