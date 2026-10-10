import { describe, expect, it } from "vitest";
import { resolveRecipientEmails } from "./recipient-emails";

describe("resolveRecipientEmails", () => {
	it("trims, lowercases and de-duplicates the recipient list", () => {
		expect(
			resolveRecipientEmails("email_only", [
				"  Payroll@Example.com ",
				"payroll@example.com",
				"hr@example.com",
			]),
		).toEqual({ ok: true, recipients: ["payroll@example.com", "hr@example.com"] });
	});

	it("drops blank entries, so a list of only blanks counts as empty", () => {
		expect(resolveRecipientEmails("s3_only", ["", "  ", "hr@example.com"])).toEqual({
			ok: true,
			recipients: ["hr@example.com"],
		});
		expect(resolveRecipientEmails("email_only", ["  "])).toEqual({
			ok: false,
			message: "At least one email recipient is required for email delivery",
		});
	});

	it.each(["email_only", "s3_and_email"] as const)(
		"refuses %s delivery without any recipients",
		(deliveryMethod) => {
			expect(resolveRecipientEmails(deliveryMethod, [])).toEqual({
				ok: false,
				message: "At least one email recipient is required for email delivery",
			});
		},
	);

	it("refuses email delivery to an invalid address, naming every invalid one", () => {
		expect(
			resolveRecipientEmails("s3_and_email", ["payroll@example.com", "not-an-email", "a b@c.de"]),
		).toEqual({ ok: false, message: "Invalid email addresses: not-an-email, a b@c.de" });
	});

	it("allows S3-only delivery without recipients", () => {
		expect(resolveRecipientEmails("s3_only", [])).toEqual({ ok: true, recipients: [] });
	});
});
