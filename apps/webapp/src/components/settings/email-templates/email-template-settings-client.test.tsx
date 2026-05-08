/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_TEMPLATE_REGISTRY } from "@/lib/email/template-registry";

const {
	insertIntoBodyMock,
	resetEmailTemplateMock,
	saveEmailTemplateMock,
	sendEmailTemplateTestMock,
	tMock,
	toastErrorMock,
} = vi.hoisted(() => ({
	insertIntoBodyMock: vi.fn(),
	resetEmailTemplateMock: vi.fn(),
	saveEmailTemplateMock: vi.fn(),
	sendEmailTemplateTestMock: vi.fn(),
	tMock: vi.fn((_key: string, defaultValue?: string) => defaultValue ?? _key),
	toastErrorMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: tMock,
	}),
}));

vi.mock("./email-template-editor", () => ({
	EmailTemplateEditor: forwardRef(
		(
			props: {
				definition: { label: string };
				variables?: Array<{ name: string; label: string; example: string }>;
				subject: string;
				html: string;
				onSubjectChange: (value: string) => void;
				onInsertVariable?: (name: string) => void;
			},
			ref,
		) => {
			const initialLabel = useRef(props.definition.label);
			useImperativeHandle(ref, () => ({
				insertIntoSubject: (value: string) => props.onSubjectChange(`${props.subject}${value}`),
				insertIntoBody: insertIntoBodyMock,
				focusSubject: vi.fn(),
			}));

			return (
				<div>
					<div>Email editor</div>
					<div data-testid="editor-layout" className="body-editor-with-variables">
						<div>Email body editor</div>
						<div>
							{props.variables?.map((variable) => (
								<button
									key={variable.name}
									type="button"
									onClick={() => props.onInsertVariable?.(variable.name)}
								>
									Insert {variable.label}
								</button>
							))}
						</div>
					</div>
					<div data-testid="editor-template">{initialLabel.current}</div>
					<div data-testid="editor-html">{props.html}</div>
					<label htmlFor="mock-subject">Subject</label>
					<input
						id="mock-subject"
						value={props.subject}
						onChange={(event) => props.onSubjectChange(event.target.value)}
					/>
				</div>
			);
		},
	),
}));

vi.mock("@/app/[locale]/(app)/settings/email-templates/actions", () => ({
	resetEmailTemplate: resetEmailTemplateMock,
	saveEmailTemplate: saveEmailTemplateMock,
	sendEmailTemplateTest: sendEmailTemplateTestMock,
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
		error: toastErrorMock,
	},
}));

import { EmailTemplateSettingsClient } from "./email-template-settings-client";

const templates = EMAIL_TEMPLATE_REGISTRY.map((definition) => ({
	definition: {
		...definition,
		starterDraftHtml: `<p>{{${definition.variables[0]?.name ?? "value"}}}</p>`,
		starterDraftPlainText: `{{${definition.variables[0]?.name ?? "value"}}}`,
	},
	override: null,
}));

describe("EmailTemplateSettingsClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the template list and initial editor", () => {
		render(<EmailTemplateSettingsClient templates={templates} />);

		expect(screen.getByRole("heading", { name: "Email Templates" })).toBeTruthy();
		expect(screen.getAllByText("Email verification").length).toBeGreaterThan(0);
		expect(screen.getByText("Password reset")).toBeTruthy();
		expect(screen.getByText("Email editor")).toBeTruthy();
		expect(screen.queryByRole("switch", { name: "Use custom template" })).toBeNull();
		expect(screen.queryByText("Custom template")).toBeNull();
		expect(screen.queryByText("System default")).toBeNull();
		expect(screen.getAllByText("Default").length).toBeGreaterThan(0);
	});

	it("uses settings email template static literal keys for page copy", () => {
		render(<EmailTemplateSettingsClient templates={templates} />);

		expect(tMock).toHaveBeenCalledWith(
			"settings.emailTemplates.eyebrow",
			"Operational communications",
		);
		expect(tMock).toHaveBeenCalledWith("settings.emailTemplates.status.default", "Default");
		expect(tMock).toHaveBeenCalledWith(
			"settings.emailTemplates.systemTemplates",
			"System templates",
		);
		expect(tMock).toHaveBeenCalledWith("settings.emailTemplates.actions.save", "Save");
	});

	it("prevents saving untouched default starter content", async () => {
		saveEmailTemplateMock.mockResolvedValue({ success: true });
		render(<EmailTemplateSettingsClient templates={templates} />);

		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(saveEmailTemplateMock).not.toHaveBeenCalled();
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Edit the email body before saving a first custom template.",
		);
	});

	it("uses placeholder starter content instead of rendered preview values", () => {
		render(<EmailTemplateSettingsClient templates={templates} />);

		fireEvent.click(screen.getByRole("button", { name: /Password reset/ }));

		expect(screen.getByTestId("editor-html").textContent).toContain("{{userName}}");
		expect(screen.getByTestId("editor-html").textContent).not.toContain(
			"/reset-password?token=preview",
		);
	});

	it("remounts the editor when selecting another template", () => {
		render(<EmailTemplateSettingsClient templates={templates} />);

		expect(screen.getByTestId("editor-template").textContent).toBe("Email verification");
		fireEvent.click(screen.getByRole("button", { name: /Password reset/ }));

		expect(screen.getByTestId("editor-template").textContent).toBe("Password reset");
	});

	it("inserts variables into the email body instead of the subject draft", () => {
		render(<EmailTemplateSettingsClient templates={templates} />);

		fireEvent.click(screen.getByRole("button", { name: "Insert User name" }));

		expect(insertIntoBodyMock).toHaveBeenCalledWith("{{userName}}");
		expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Verify your email address");
		expect(screen.getByTestId("editor-layout").className).toContain("body-editor-with-variables");
	});

	it("prevents saving a first custom template when only the subject changed", () => {
		saveEmailTemplateMock.mockResolvedValue({ success: true });
		render(<EmailTemplateSettingsClient templates={templates} />);

		fireEvent.change(screen.getByLabelText("Subject"), {
			target: { value: "Custom verify {{userName}}" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(saveEmailTemplateMock).not.toHaveBeenCalled();
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Edit the email body before saving a first custom template.",
		);
	});

	it("allows subject-only edits for an existing override", async () => {
		saveEmailTemplateMock.mockResolvedValue({ success: true });
		const overriddenTemplates = templates.map((template) =>
			template.definition.key === "email-verification"
				? {
						...template,
						override: {
							subject: "Existing custom subject",
							html: "<p>Existing custom body</p>",
							plainText: "Existing custom body",
							editorDocument: { type: "doc" },
							isEnabled: true,
						},
					}
				: template,
		);
		render(<EmailTemplateSettingsClient templates={overriddenTemplates} />);
		expect(screen.getAllByText("Customized").length).toBeGreaterThan(0);

		fireEvent.change(screen.getByLabelText("Subject"), {
			target: { value: "Updated custom subject" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => {
			expect(saveEmailTemplateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					subject: "Updated custom subject",
					html: "<p>Existing custom body</p>",
				}),
			);
		});
		const payload = saveEmailTemplateMock.mock.calls[0]?.[0];
		expect(payload).not.toHaveProperty("isEnabled");
	});

	it("omits enabled state from send test payloads", async () => {
		sendEmailTemplateTestMock.mockResolvedValue({ success: true });
		render(<EmailTemplateSettingsClient templates={templates} />);

		fireEvent.click(screen.getByRole("button", { name: "Send test" }));

		await waitFor(() => {
			expect(sendEmailTemplateTestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					templateKey: "email-verification",
					subject: "Verify your email address",
				}),
			);
		});
		const payload = sendEmailTemplateTestMock.mock.calls[0]?.[0];
		expect(payload).not.toHaveProperty("isEnabled");
	});

	it("resets an override back to the system template draft", async () => {
		resetEmailTemplateMock.mockResolvedValue({ success: true });
		saveEmailTemplateMock.mockResolvedValue({ success: true });
		const overriddenTemplates = templates.map((template) =>
			template.definition.key === "email-verification"
				? {
						...template,
						override: {
							subject: "Existing custom subject",
							html: "<p>Existing custom body</p>",
							plainText: "Existing custom body",
							editorDocument: { type: "doc" },
							isEnabled: true,
						},
					}
				: template,
		);
		render(<EmailTemplateSettingsClient templates={overriddenTemplates} />);
		const selectedStatus = () =>
			screen
				.getByRole("heading", { name: "Email Templates" })
				.parentElement?.parentElement?.querySelector('[data-slot="badge"]');

		expect(selectedStatus()?.textContent).toBe("Customized");
		expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Existing custom subject");
		fireEvent.click(screen.getByRole("button", { name: "Reset to system template" }));

		await waitFor(() => {
			expect(resetEmailTemplateMock).toHaveBeenCalledWith("email-verification");
		});
		expect(selectedStatus()?.textContent).toBe("Default");
		expect(screen.getByLabelText("Subject")).toHaveProperty("value", "Verify your email address");
		expect(screen.getByTestId("editor-html").textContent).toContain("{{userName}}");
		expect(screen.queryByText("Customized")).toBeNull();
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
		});

		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(saveEmailTemplateMock).not.toHaveBeenCalled();
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Edit the email body before saving a first custom template.",
		);
	});
});
