/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_TEMPLATE_REGISTRY } from "@/lib/email/template-registry";

const { resetEmailTemplateMock, saveEmailTemplateMock, sendEmailTemplateTestMock, toastErrorMock } =
	vi.hoisted(() => ({
		resetEmailTemplateMock: vi.fn(),
		saveEmailTemplateMock: vi.fn(),
		sendEmailTemplateTestMock: vi.fn(),
		toastErrorMock: vi.fn(),
	}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("./email-template-editor", () => ({
	EmailTemplateEditor: forwardRef(
		(
			props: {
				definition: { label: string };
				subject: string;
				html: string;
				onSubjectChange: (value: string) => void;
			},
			ref,
		) => {
			const initialLabel = useRef(props.definition.label);
			useImperativeHandle(ref, () => ({
				insertIntoSubject: (value: string) => props.onSubjectChange(`${props.subject}${value}`),
				focusSubject: vi.fn(),
			}));

			return (
				<div>
					<div>Email editor</div>
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
	});

	it("prevents saving untouched default starter content", async () => {
		saveEmailTemplateMock.mockResolvedValue({ success: true });
		render(<EmailTemplateSettingsClient templates={templates} />);

		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(saveEmailTemplateMock).not.toHaveBeenCalled();
		expect(toastErrorMock).toHaveBeenCalledWith(
			"Edit this template before saving a custom override.",
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

	it("inserts variables into the subject draft", () => {
		render(<EmailTemplateSettingsClient templates={templates} />);

		fireEvent.click(screen.getByRole("button", { name: "Insert User name" }));

		expect(screen.getByLabelText("Subject")).toHaveProperty(
			"value",
			"Verify your email address{{userName}}",
		);
	});

	it("saves a default template after the subject is edited", async () => {
		saveEmailTemplateMock.mockResolvedValue({ success: true });
		render(<EmailTemplateSettingsClient templates={templates} />);

		fireEvent.change(screen.getByLabelText("Subject"), {
			target: { value: "Custom verify {{userName}}" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => {
			expect(saveEmailTemplateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					subject: "Custom verify {{userName}}",
					html: "<p>{{userName}}</p>",
				}),
			);
		});
	});
});
