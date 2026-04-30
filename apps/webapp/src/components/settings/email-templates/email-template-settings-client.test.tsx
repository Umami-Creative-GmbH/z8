/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
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
	EmailTemplateEditor: () => <div>Email editor</div>,
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

describe("EmailTemplateSettingsClient", () => {
	it("renders the template list and initial editor", () => {
		render(
			<EmailTemplateSettingsClient
				templates={EMAIL_TEMPLATE_REGISTRY.map((definition) => ({
					definition,
					override: null,
				}))}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Email Templates" })).toBeTruthy();
		expect(screen.getAllByText("Email verification").length).toBeGreaterThan(0);
		expect(screen.getByText("Password reset")).toBeTruthy();
		expect(screen.getByText("Email editor")).toBeTruthy();
	});
});
