/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { EMAIL_TEMPLATE_REGISTRY } from "@/lib/email/template-registry";

const { resetEmailTemplateMock, saveEmailTemplateMock, sendEmailTemplateTestMock } = vi.hoisted(
	() => ({
		resetEmailTemplateMock: vi.fn(),
		saveEmailTemplateMock: vi.fn(),
		sendEmailTemplateTestMock: vi.fn(),
	}),
);

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
		error: vi.fn(),
	},
}));

import { EmailTemplateSettingsClient } from "./email-template-settings-client";

const templates = EMAIL_TEMPLATE_REGISTRY.map((definition) => ({
	definition: {
		...definition,
		defaultPreviewHtml: `<p>Preview for ${definition.key}</p>`,
		defaultPreviewPlainText: `Preview for ${definition.key}`,
	},
	override: null,
}));

describe("EmailTemplateSettingsClient", () => {
	it("renders the template list and initial editor", () => {
		render(<EmailTemplateSettingsClient templates={templates} />);

		expect(screen.getByRole("heading", { name: "Email Templates" })).toBeTruthy();
		expect(screen.getAllByText("Email verification").length).toBeGreaterThan(0);
		expect(screen.getByText("Password reset")).toBeTruthy();
		expect(screen.getByText("Email editor")).toBeTruthy();
	});

	it("saves untouched default templates with rendered preview content", async () => {
		saveEmailTemplateMock.mockResolvedValue({ success: true });
		render(<EmailTemplateSettingsClient templates={templates} />);

		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => {
			expect(saveEmailTemplateMock).toHaveBeenCalledWith(
				expect.objectContaining({
					templateKey: "email-verification",
					html: "<p>Preview for email-verification</p>",
					plainText: "Preview for email-verification",
				}),
			);
		});
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
});
