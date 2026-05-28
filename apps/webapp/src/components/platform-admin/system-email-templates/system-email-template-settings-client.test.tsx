/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type Ref, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY } from "@/lib/email/system-template-registry";

const {
	resetPlatformSystemEmailTemplateMock,
	savePlatformSystemEmailTemplateMock,
	sendPlatformSystemEmailTemplateTestMock,
	tMock,
} = vi.hoisted(() => ({
	resetPlatformSystemEmailTemplateMock: vi.fn(),
	savePlatformSystemEmailTemplateMock: vi.fn(),
	sendPlatformSystemEmailTemplateTestMock: vi.fn(),
	tMock: vi.fn((_key: string, defaultValue?: string) => defaultValue ?? _key),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: tMock,
	}),
}));

vi.mock("@/components/settings/email-templates/email-template-editor", () => ({
	EmailTemplateEditor: ({
		ref,
		...props
	}: {
		ref?: Ref<{
			insertIntoSubject: () => void;
			insertIntoBody: () => void;
			focusSubject: () => void;
		}>;
		definition: { label: string };
		subject: string;
		html: string;
		onSubjectChange: (value: string) => void;
	}) => {
		useImperativeHandle(ref, () => ({
			insertIntoSubject: vi.fn(),
			insertIntoBody: vi.fn(),
			focusSubject: vi.fn(),
		}));

		return (
			<div>
				<div>Email editor</div>
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
}));

vi.mock("@/app/[locale]/(admin)/platform-admin/system-email-templates/actions", () => ({
	resetPlatformSystemEmailTemplate: resetPlatformSystemEmailTemplateMock,
	savePlatformSystemEmailTemplate: savePlatformSystemEmailTemplateMock,
	sendPlatformSystemEmailTemplateTest: sendPlatformSystemEmailTemplateTestMock,
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

import { SystemEmailTemplateSettingsClient } from "./system-email-template-settings-client";

const templates = PLATFORM_SYSTEM_EMAIL_TEMPLATE_REGISTRY.map((definition) => ({
	definition: {
		...definition,
		starterDraftHtml: `<p>{{${definition.variables[0]?.name ?? "value"}}}</p>`,
		starterDraftPlainText: `{{${definition.variables[0]?.name ?? "value"}}}`,
	},
	override: null,
}));

describe("SystemEmailTemplateSettingsClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("disables reset for default templates", () => {
		render(<SystemEmailTemplateSettingsClient templates={templates} />);

		expect(screen.getByRole("button", { name: "Reset to system template" })).toHaveProperty(
			"disabled",
			true,
		);
	});

	it("confirms before resetting a platform system template override", async () => {
		resetPlatformSystemEmailTemplateMock.mockResolvedValue({ success: true });
		const overriddenTemplates = templates.map((template) =>
			template.definition.key === "billing-trial-ending"
				? {
						...template,
						override: {
							subject: "Existing platform subject",
							html: "<p>Existing platform body</p>",
							plainText: "Existing platform body",
							editorDocument: { type: "doc" },
							isEnabled: true,
						},
					}
				: template,
		);
		render(<SystemEmailTemplateSettingsClient templates={overriddenTemplates} />);

		fireEvent.click(screen.getByRole("button", { name: "Reset to system template" }));

		expect(resetPlatformSystemEmailTemplateMock).not.toHaveBeenCalled();
		expect(
			screen.getByRole("alertdialog", { name: "Reset Platform System Template?" }),
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Reset platform system template" }));

		await waitFor(() => {
			expect(resetPlatformSystemEmailTemplateMock).toHaveBeenCalledWith("billing-trial-ending");
		});
		expect(screen.getByRole("button", { name: "Reset to system template" })).toHaveProperty(
			"disabled",
			true,
		);
	});
});
