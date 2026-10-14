import { render } from "react-email";
import { describe, expect, it } from "vitest";
import type { EmailTranslate } from "../email-i18n";
import { renderNotificationEmail } from "../render";
import { EmailLayout, EmailText } from "./email-layout";

const GERMAN: Record<string, string> = {
	"emails.layout.footer": "Diese E-Mail wurde von Z8 gesendet.",
	"emails.layout.actionFallback":
		"Falls die Schaltfläche nicht funktioniert, öffnen Sie diesen Link:",
	"emails.notification.openAction": "Z8 öffnen",
};

/** A stand-in for the `emails` catalog in German; ICU `{name}` params only. */
const germanT: EmailTranslate = (key, defaultValue, params) =>
	(GERMAN[key] ?? defaultValue).replace(/\{(\w+)\}/g, (match, name: string) =>
		params && name in params ? String(params[name]) : match,
	);

const englishT: EmailTranslate = (_key, defaultValue) => defaultValue;

describe("renderNotificationEmail", () => {
	it("writes the shared layout in the recipient language", async () => {
		const html = await renderNotificationEmail({
			locale: "de",
			t: germanT,
			title: "Abwesenheitsanfrage genehmigt",
			message: "Ihre Abwesenheit vom 1.–2. Mai 2026 wurde genehmigt.",
			actionUrl: "https://org.example.com/absences",
		});

		expect(html).toContain('lang="de"');
		expect(html).toContain("Abwesenheitsanfrage genehmigt");
		expect(html).toContain("Ihre Abwesenheit vom 1.–2. Mai 2026 wurde genehmigt.");
		expect(html).toContain("Z8 öffnen");
		expect(html).toContain('href="https://org.example.com/absences"');
		expect(html).toContain("Diese E-Mail wurde von Z8 gesendet.");
		expect(html).toContain("Falls die Schaltfläche nicht funktioniert");
		expect(html).not.toContain("Open Z8");
	});

	it("escapes notification text and keeps its line breaks", async () => {
		const html = await renderNotificationEmail({
			locale: "en",
			t: englishT,
			title: "Approved <b>now</b>",
			message: "First line\nSecond & last line",
			actionUrl: "https://org.example.com",
		});

		expect(html).toContain("Approved &lt;b&gt;now&lt;/b&gt;");
		expect(html).toContain("First line");
		expect(html).toContain("Second &amp; last line");
		expect(html).toMatch(/First line<br\s*\/?>Second/);
		expect(html).toContain("Open Z8");
	});

	it("shows detail rows when a notification carries them", async () => {
		const html = await renderNotificationEmail({
			locale: "en",
			t: englishT,
			title: "Export ready",
			message: "Your export is ready.",
			details: [
				{ label: "File", value: "hours.csv" },
				{ label: "Expires", value: "Oct 20, 2026, 14:00 (Europe/Berlin)" },
			],
			actionUrl: "https://org.example.com/exports",
		});

		expect(html).toContain("hours.csv");
		expect(html).toContain("Oct 20, 2026, 14:00 (Europe/Berlin)");
		expect(html.indexOf("File")).toBeLessThan(html.indexOf("hours.csv"));
	});
});

describe("EmailLayout", () => {
	it("frames a dedicated template's own content with the translated chrome", async () => {
		const html = await render(
			<EmailLayout locale="de" t={germanT} title="E-Mail bestätigen" preview="Bitte bestätigen">
				<EmailText>Hallo Alex,</EmailText>
			</EmailLayout>,
		);

		expect(html).toContain('lang="de"');
		expect(html).toContain("E-Mail bestätigen");
		expect(html).toContain("Hallo Alex,");
		expect(html).toContain("Bitte bestätigen");
		expect(html).toContain("Diese E-Mail wurde von Z8 gesendet.");
		// No action, so no button fallback copy.
		expect(html).not.toContain("Falls die Schaltfläche nicht funktioniert");
	});
});
