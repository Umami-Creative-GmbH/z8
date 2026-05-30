import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformSystemEmailTemplateOverride } from "./system-template-overrides";
import {
	type RenderedPlatformSystemEmailTemplate,
	renderPlatformSystemEmailTemplate,
	type SkippedPlatformSystemEmailTemplate,
} from "./system-template-renderer";

const warnMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		warn: warnMock,
	}),
}));

vi.mock("./system-template-overrides", () => ({
	getPlatformSystemEmailTemplateOverride: vi.fn(),
}));

const getPlatformSystemEmailTemplateOverrideMock = vi.mocked(
	getPlatformSystemEmailTemplateOverride,
);

const billingData = {
	organizationName: "Acme Operations",
	planName: "Business",
	daysRemaining: 2,
	trialEndsAt: "May 26, 2026",
	billingUrl: "https://app.z8-time.app/settings/billing",
};

type RenderPlatformSystemEmailTemplateResult = Awaited<
	ReturnType<typeof renderPlatformSystemEmailTemplate>
>;

function expectRenderedTemplate(
	result: RenderPlatformSystemEmailTemplateResult,
): asserts result is RenderedPlatformSystemEmailTemplate {
	expect("skipped" in result).toBe(false);
	if ("skipped" in result) {
		throw new Error("Expected rendered template result");
	}
}

function expectSkippedTemplate(
	result: RenderPlatformSystemEmailTemplateResult,
): asserts result is SkippedPlatformSystemEmailTemplate {
	expect("skipped" in result).toBe(true);
	if (!("skipped" in result)) {
		throw new Error("Expected skipped template result");
	}
}

describe("renderPlatformSystemEmailTemplate", () => {
	beforeEach(() => {
		getPlatformSystemEmailTemplateOverrideMock.mockReset();
		warnMock.mockReset();
	});

	it("renders the default platform system template when no override exists", async () => {
		getPlatformSystemEmailTemplateOverrideMock.mockResolvedValue(null);

		const result = await renderPlatformSystemEmailTemplate({
			templateKey: "billing-trial-ending",
			data: billingData,
		});

		expect(getPlatformSystemEmailTemplateOverrideMock).toHaveBeenCalledWith("billing-trial-ending");
		expectRenderedTemplate(result);
		expect(result.subject).toBe("Your Z8 trial ends in 2 days");
		expect(result.html).toContain("Acme Operations");
		expect(result.usedOverride).toBe(false);
	});

	it("returns a skipped result when the platform override is disabled", async () => {
		getPlatformSystemEmailTemplateOverrideMock.mockResolvedValue({
			isEnabled: false,
			subject: "Trial ends for {{organizationName}}",
			html: "<p>Disabled override</p>",
			plainText: null,
		});

		const result = await renderPlatformSystemEmailTemplate({
			templateKey: "billing-trial-ending",
			data: billingData,
		});

		expectSkippedTemplate(result);
		expect(result.reason).toBe("template-disabled");
		expect(result).not.toHaveProperty("html");
	});

	it("renders an enabled platform override with interpolated subject, html, and plain text", async () => {
		getPlatformSystemEmailTemplateOverrideMock.mockResolvedValue({
			isEnabled: true,
			subject: "Trial ends for {{organizationName}}",
			html: '<a href="{{billingUrl}}">Keep {{planName}}</a>',
			plainText: "Review {{billingUrl}} before {{trialEndsAt}}.",
		});

		const result = await renderPlatformSystemEmailTemplate({
			templateKey: "billing-trial-ending",
			data: billingData,
		});

		expectRenderedTemplate(result);
		expect(result).toEqual({
			subject: "Trial ends for Acme Operations",
			html: '<a href="https://app.z8-time.app/settings/billing">Keep Business</a>',
			plainText: "Review https://app.z8-time.app/settings/billing before May 26, 2026.",
			usedOverride: true,
		});
	});

	it("sanitizes unsafe platform override html after interpolation", async () => {
		getPlatformSystemEmailTemplateOverrideMock.mockResolvedValue({
			isEnabled: true,
			subject: "Trial ends for {{organizationName}}",
			html: '<p onclick="alert(1)">{{billingUrl}}</p><script>alert(1)</script>',
			plainText: null,
		});

		const result = await renderPlatformSystemEmailTemplate({
			templateKey: "billing-trial-ending",
			data: billingData,
		});

		expectRenderedTemplate(result);
		expect(result.html).toBe("<p>https://app.z8-time.app/settings/billing</p>");
		expect(result.html).not.toContain("onclick");
		expect(result.html).not.toContain("script");
		expect(result.usedOverride).toBe(true);
	});

	it("falls back to the default template when the platform override references an unknown variable", async () => {
		getPlatformSystemEmailTemplateOverrideMock.mockResolvedValue({
			isEnabled: true,
			subject: "Trial ends for {{secret}}",
			html: "<p>{{billingUrl}}</p>",
			plainText: null,
		});

		const result = await renderPlatformSystemEmailTemplate({
			templateKey: "billing-trial-ending",
			data: billingData,
		});

		expectRenderedTemplate(result);
		expect(result.subject).toBe("Your Z8 trial ends in 2 days");
		expect(result.html).toContain("Acme Operations");
		expectRenderedTemplate(result);
		expect(result.usedOverride).toBe(false);
		expect(warnMock).toHaveBeenCalledWith(
			{
				errors: ["Unknown variable: secret"],
				templateKey: "billing-trial-ending",
			},
			"Invalid platform system email template override, falling back to default",
		);
	});

	it("falls back to the default template when sanitized platform override html is empty", async () => {
		getPlatformSystemEmailTemplateOverrideMock.mockResolvedValue({
			isEnabled: true,
			subject: "Trial ends for {{organizationName}}",
			html: "<script>alert(1)</script>",
			plainText: null,
		});

		const result = await renderPlatformSystemEmailTemplate({
			templateKey: "billing-trial-ending",
			data: billingData,
		});

		expectRenderedTemplate(result);
		expect(result.usedOverride).toBe(false);
		expect(result.subject).toBe("Your Z8 trial ends in 2 days");
		expect(warnMock).toHaveBeenCalledWith(
			{ templateKey: "billing-trial-ending" },
			"Platform system email template override rendered empty HTML, falling back to default",
		);
	});
});
