import { describe, expect, it } from "vitest";
import { resolveExportRecipients } from "./export-recipients";

describe("resolveExportRecipients", () => {
	it("trims, lowercases and de-duplicates the recipient list", () => {
		expect(
			resolveExportRecipients("email_only", [
				"  Payroll@Example.com ",
				"payroll@example.com",
				"hr@example.com",
			]),
		).toEqual({ ok: true, recipients: ["payroll@example.com", "hr@example.com"] });
	});

	it.each(["email_only", "s3_and_email"] as const)(
		"refuses %s delivery without any recipients",
		(deliveryMethod) => {
			expect(resolveExportRecipients(deliveryMethod, [])).toEqual({
				ok: false,
				message: "At least one email recipient is required for email delivery",
			});
		},
	);

	it("refuses email delivery to an invalid address, naming every invalid one", () => {
		expect(
			resolveExportRecipients("s3_and_email", ["payroll@example.com", "not-an-email", "a b@c.de"]),
		).toEqual({ ok: false, message: "Invalid email addresses: not-an-email, a b@c.de" });
	});

	it("allows S3-only delivery without recipients", () => {
		expect(resolveExportRecipients("s3_only", [])).toEqual({ ok: true, recipients: [] });
	});
});
