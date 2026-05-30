import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	conditions: [] as unknown[],
	deleteWhere: undefined as unknown,
	getSession: vi.fn(),
	insertValues: undefined as unknown,
	revalidatePath: vi.fn(),
	sendEmail: vi.fn(),
	templates: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/cache", () => ({
	revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => {
		mocks.conditions.push(...conditions);
		return { and: conditions };
	}),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		delete: vi.fn(() => ({
			where: vi.fn(async (where: unknown) => {
				mocks.deleteWhere = where;
			}),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((values: unknown) => {
				mocks.insertValues = values;
				return {
					onConflictDoUpdate: vi.fn(async () => undefined),
				};
			}),
		})),
		query: {
			platformSystemEmailTemplate: {
				findMany: vi.fn(async () => mocks.templates),
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	platformSystemEmailTemplate: {
		isEnabled: "isEnabled",
		templateKey: "templateKey",
	},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mocks.getSession,
		},
	},
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: mocks.sendEmail,
}));

import { validatePlatformSystemEmailTemplateInput } from "@/lib/email/system-template-settings";
import {
	listPlatformSystemEmailTemplates,
	resetPlatformSystemEmailTemplate,
	savePlatformSystemEmailTemplate,
	sendPlatformSystemEmailTemplateTest,
} from "./actions";

describe("platform system email template actions", () => {
	beforeEach(() => {
		mocks.conditions = [];
		mocks.deleteWhere = undefined;
		mocks.getSession.mockReset();
		mocks.getSession.mockResolvedValue({
			user: { id: "user_1", email: "admin@example.com", role: "admin" },
		});
		mocks.insertValues = undefined;
		mocks.revalidatePath.mockReset();
		mocks.sendEmail.mockReset();
		mocks.sendEmail.mockResolvedValue({ success: true });
		mocks.templates = [];
	});

	it("rejects unknown variables before saving", () => {
		const result = validatePlatformSystemEmailTemplateInput({
			templateKey: "billing-trial-ending",
			subject: "Trial {{secret}}",
			html: "<p>{{billingUrl}}</p>",
			editorDocument: { root: {} },
			isEnabled: true,
		});

		expect(result.success).toBe(false);
		expect(result.errors).toContain("Unknown variable: secret");
	});

	it("returns validation errors for malformed runtime input", () => {
		expect(validatePlatformSystemEmailTemplateInput(null)).toEqual({
			success: false,
			errors: ["Template input must be an object"],
		});
		expect(validatePlatformSystemEmailTemplateInput("not-an-object")).toEqual({
			success: false,
			errors: ["Template input must be an object"],
		});
		expect(validatePlatformSystemEmailTemplateInput([])).toEqual({
			success: false,
			errors: ["Template input must be an object"],
		});
	});

	it("lists platform system templates with global overrides", async () => {
		mocks.templates = [
			{ templateKey: "billing-trial-ending", subject: "Override", isEnabled: true },
		];

		const templates = await listPlatformSystemEmailTemplates();

		expect(mocks.getSession).toHaveBeenCalledTimes(1);
		expect(templates.find((entry) => entry.key === "billing-trial-ending")?.override).toEqual({
			templateKey: "billing-trial-ending",
			subject: "Override",
			isEnabled: true,
		});
	});

	it("requires platform admin before saving templates", async () => {
		mocks.getSession.mockResolvedValue({
			user: { id: "user_2", email: "member@example.com", role: "user" },
		});

		const result = await savePlatformSystemEmailTemplate({
			templateKey: "billing-trial-ending",
			subject: "Trial {{organizationName}}",
			html: "<p>{{billingUrl}}</p>",
			editorDocument: { root: {} },
		});

		expect(result).toEqual({ success: false, errors: ["Unauthorized"] });
		expect(mocks.insertValues).toBeUndefined();
	});

	it("saves sanitized global platform system templates without an organization id", async () => {
		const result = await savePlatformSystemEmailTemplate({
			templateKey: "billing-trial-ending",
			subject: "Trial {{organizationName}}",
			html: '<p>{{billingUrl}}</p><script>alert("x")</script>',
			editorDocument: { root: { type: "email" } },
			isEnabled: true,
		});

		expect(result).toEqual({ success: true });
		expect(mocks.insertValues).toMatchObject({
			templateKey: "billing-trial-ending",
			createdByUserId: "user_1",
			updatedByUserId: "user_1",
			isEnabled: true,
		});
		expect(mocks.insertValues).not.toHaveProperty("organizationId");
		expect((mocks.insertValues as { html: string }).html).toBe("<p>{{billingUrl}}</p>");
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/platform-admin/system-email-templates");
	});

	it("rejects malformed save input without writing", async () => {
		const result = await savePlatformSystemEmailTemplate(null as never);

		expect(result).toEqual({
			success: false,
			errors: ["Template input must be an object"],
		});
		expect(mocks.insertValues).toBeUndefined();
	});

	it("resets a global platform system template", async () => {
		const result = await resetPlatformSystemEmailTemplate("billing-trial-ending");

		expect(result).toEqual({ success: true });
		expect(mocks.conditions).toContainEqual({ eq: ["templateKey", "billing-trial-ending"] });
		expect(JSON.stringify(mocks.deleteWhere)).not.toContain("organizationId");
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/platform-admin/system-email-templates");
	});

	it("test sends through the system transport to the current platform admin", async () => {
		const result = await sendPlatformSystemEmailTemplateTest({
			templateKey: "billing-trial-ending",
			subject: "Trial {{organizationName}}",
			html: '<a href="{{billingUrl}}">Billing</a>',
			editorDocument: { root: { type: "email" } },
		});

		expect(result).toEqual({ success: true });
		expect(mocks.insertValues).toBeUndefined();
		expect(mocks.sendEmail).toHaveBeenCalledWith({
			to: "admin@example.com",
			subject: "Trial Acme Operations",
			html: '<a href="https://app.z8-time.app/settings/billing">Billing</a>',
		});
	});

	it("rejects malformed test-send input without sending", async () => {
		const result = await sendPlatformSystemEmailTemplateTest(123 as never);

		expect(result).toEqual({
			success: false,
			errors: ["Template input must be an object"],
		});
		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});

	it("requires platform admin before sending test email", async () => {
		mocks.getSession.mockResolvedValue(null);

		const result = await sendPlatformSystemEmailTemplateTest({
			templateKey: "billing-trial-ending",
			subject: "Trial {{organizationName}}",
			html: "<p>{{billingUrl}}</p>",
			editorDocument: { root: {} },
		});

		expect(result).toEqual({ success: false, errors: ["Unauthorized"] });
		expect(mocks.sendEmail).not.toHaveBeenCalled();
	});
});
