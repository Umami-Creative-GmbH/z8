import { describe, expect, it } from "vitest";
import type { EmailTranslate, EmailTranslator } from "../email-i18n";
import {
	renderEmailVerification,
	renderExportFailed,
	renderExportReady,
	renderOrganizationDeletion,
	renderOrganizationInvitation,
	renderPasswordReset,
	renderSecurityAlert,
} from "../render";

/** Stand-ins for the `emails` catalogs (until Tolgee sync fills them); ICU `{name}` only. */
const CATALOGS: Record<string, Record<string, string>> = {
	de: {
		"emails.common.greeting": "Hallo {name},",
		"emails.layout.footer": "Diese E-Mail wurde von Z8 gesendet.",
		"emails.verification.title": "E-Mail-Adresse bestätigen",
		"emails.verification.action": "E-Mail-Adresse bestätigen",
		"emails.passwordReset.title": "Passwort zurücksetzen",
		"emails.passwordReset.action": "Passwort zurücksetzen",
		"emails.invitation.title": "Einladung zu {organizationName}",
		"emails.invitation.body": "{inviterName} lädt dich als {role} zu {organizationName} ein.",
		"emails.invitation.roles.admin": "Administrator",
		"emails.invitation.action": "Einladung annehmen",
		"emails.securityAlert.passwordChanged.title": "Passwort geändert",
		"emails.securityAlert.time": "Zeitpunkt",
		"emails.securityAlert.action": "Sicherheitseinstellungen prüfen",
		"emails.exportReady.title": "Dein Datenexport ist fertig",
		"emails.exportReady.expiresAt": "Verfügbar bis",
		"emails.exportFailed.title": "Datenexport fehlgeschlagen",
		"emails.exportFailed.action": "Erneut versuchen",
		"emails.organizationDeletion.title": "Organisation zur Löschung vorgemerkt",
		"emails.organizationDeletion.permanentAt": "Endgültige Löschung",
		"emails.organizationDeletion.action": "Organisation wiederherstellen",
	},
	it: {
		"emails.common.greeting": "Ciao {name},",
		"emails.layout.footer": "Questa email è stata inviata da Z8.",
		"emails.verification.title": "Verifica il tuo indirizzo email",
		"emails.verification.action": "Verifica indirizzo email",
		"emails.passwordReset.title": "Reimposta la password",
		"emails.passwordReset.action": "Reimposta password",
		"emails.invitation.title": "Sei stato invitato in {organizationName}",
		"emails.invitation.body":
			"{inviterName} ti ha invitato a unirti a {organizationName} come {role}.",
		"emails.invitation.roles.admin": "Amministratore",
		"emails.invitation.action": "Accetta l'invito",
		"emails.securityAlert.passwordChanged.title": "Password modificata",
		"emails.securityAlert.time": "Ora",
		"emails.securityAlert.action": "Controlla le impostazioni di sicurezza",
		"emails.exportReady.title": "La tua esportazione dei dati è pronta",
		"emails.exportReady.expiresAt": "Disponibile fino al",
		"emails.exportFailed.title": "Esportazione dei dati non riuscita",
		"emails.exportFailed.action": "Riprova",
		"emails.organizationDeletion.title": "Organizzazione programmata per l'eliminazione",
		"emails.organizationDeletion.permanentAt": "Eliminazione definitiva",
		"emails.organizationDeletion.action": "Ripristina organizzazione",
	},
};

function translator(locale: string): EmailTranslator {
	const catalog = CATALOGS[locale] ?? {};
	const t: EmailTranslate = (key, defaultValue, params) =>
		(catalog[key] ?? defaultValue).replace(/\{(\w+)\}/g, (match, name: string) =>
			params && name in params ? String(params[name]) : match,
		);
	return { locale, t };
}

/** The HTML with entities decoded, so assertions read like the email. */
function text(html: string): string {
	return html
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&");
}

describe("dedicated email templates", () => {
	it("renders email verification in en, de and it", async () => {
		const data = {
			userName: "Alex",
			verificationUrl: "https://app.example.com/verify?token=abc",
			appUrl: "https://app.example.com",
		};

		const en = text(await renderEmailVerification(data, translator("en")));
		expect(en).toContain('lang="en"');
		expect(en).toContain("Verify your email address");
		expect(en).toContain("Hi Alex,");
		expect(en).toContain('href="https://app.example.com/verify?token=abc"');
		expect(en).toContain("The link expires in 1 hour.");

		const de = text(await renderEmailVerification(data, translator("de")));
		expect(de).toContain('lang="de"');
		expect(de).toContain("E-Mail-Adresse bestätigen");
		expect(de).toContain("Hallo Alex,");
		expect(de).toContain("Diese E-Mail wurde von Z8 gesendet.");

		const it_ = text(await renderEmailVerification(data, translator("it")));
		expect(it_).toContain('lang="it"');
		expect(it_).toContain("Verifica il tuo indirizzo email");
		expect(it_).toContain("Ciao Alex,");
	});

	it("renders the password reset in en, de and it", async () => {
		const data = { userName: "Alex", resetUrl: "https://app.example.com/reset?token=abc" };

		const en = text(await renderPasswordReset(data, translator("en")));
		expect(en).toContain("Reset your password");
		expect(en).toContain('href="https://app.example.com/reset?token=abc"');

		const de = text(await renderPasswordReset(data, translator("de")));
		expect(de).toContain('lang="de"');
		expect(de).toContain("Passwort zurücksetzen");
		expect(de).not.toContain("Reset your password");

		const it_ = text(await renderPasswordReset(data, translator("it")));
		expect(it_).toContain("Reimposta la password");
	});

	it("renders the invitation with a translated role in en, de and it", async () => {
		const data = {
			email: "new@example.com",
			organizationName: "Acme",
			inviterName: "Sam",
			role: "admin",
			invitationUrl: "https://acme.example.com/accept-invitation/inv-1",
		};

		const en = text(await renderOrganizationInvitation(data, translator("en")));
		expect(en).toContain("You have been invited to Acme");
		expect(en).toContain("Sam has invited you to join Acme as Admin.");
		expect(en).toContain("new@example.com");

		const de = text(await renderOrganizationInvitation(data, translator("de")));
		expect(de).toContain("Einladung zu Acme");
		expect(de).toContain("Sam lädt dich als Administrator zu Acme ein.");

		const it_ = text(await renderOrganizationInvitation(data, translator("it")));
		expect(it_).toContain('lang="it"');
		expect(it_).toContain("Sam ti ha invitato a unirti a Acme come Amministratore.");
		expect(it_).toContain("Accetta l'invito");
	});

	it("renders the security alert in en, de and it with the given time", async () => {
		const data = {
			userName: "Alex",
			eventType: "password_changed" as const,
			timestamp: "13 Oct 2026, 14:05 (Europe/Berlin)",
			ipAddress: "203.0.113.7",
			securitySettingsUrl: "https://app.example.com/settings/security",
			appUrl: "https://app.example.com",
		};

		const en = text(await renderSecurityAlert(data, translator("en")));
		expect(en).toContain("Password changed");
		expect(en).toContain("13 Oct 2026, 14:05 (Europe/Berlin)");
		expect(en).toContain("203.0.113.7");
		expect(en).toContain("Review security settings");

		const de = text(await renderSecurityAlert(data, translator("de")));
		expect(de).toContain("Passwort geändert");
		expect(de).toContain("Zeitpunkt");
		expect(de).toContain("Sicherheitseinstellungen prüfen");

		const it_ = text(await renderSecurityAlert(data, translator("it")));
		expect(it_).toContain("Password modificata");
	});

	it("renders export ready and export failed in en, de and it", async () => {
		const ready = {
			recipientName: "Alex",
			organizationName: "Acme",
			categories: ["Abwesenheiten", "Teams"],
			fileSize: "2 MB",
			downloadUrl: "https://app.example.com/de/settings/export/history/org-1",
			expiresAt: "20.10.2026, 14:00 (Europe/Berlin)",
		};
		const failed = {
			recipientName: "Alex",
			organizationName: "Acme",
			categories: ["Teams"],
			errorMessage: "Source timeout",
			retryUrl: "https://app.example.com/settings/export",
		};

		const enReady = text(await renderExportReady(ready, translator("en")));
		expect(enReady).toContain("Your data export is ready");
		expect(enReady).toContain("Available until");
		const enFailed = text(await renderExportFailed(failed, translator("en")));
		expect(enFailed).toContain("Data export failed");
		expect(enFailed).toContain("Source timeout");

		const deReady = text(await renderExportReady(ready, translator("de")));
		expect(deReady).toContain("Dein Datenexport ist fertig");
		expect(deReady).toContain("Verfügbar bis");
		expect(deReady).toContain("20.10.2026, 14:00 (Europe/Berlin)");
		expect(deReady).toContain("Abwesenheiten, Teams");
		const deFailed = text(await renderExportFailed(failed, translator("de")));
		expect(deFailed).toContain("Datenexport fehlgeschlagen");
		expect(deFailed).toContain("Erneut versuchen");

		expect(text(await renderExportReady(ready, translator("it")))).toContain(
			"La tua esportazione dei dati è pronta",
		);
		expect(text(await renderExportFailed(failed, translator("it")))).toContain("Riprova");
	});

	it("renders the organization deletion in en, de and it", async () => {
		const data = {
			userName: "Alex",
			organizationName: "Acme",
			deletedByName: "Sam",
			deletionDate: "Oct 13, 2026, 14:05 (Europe/Berlin)",
			permanentDeletionDate: "Oct 18, 2026, 14:05 (Europe/Berlin)",
			recoveryUrl: "https://acme.example.com/settings/organizations",
		};

		const en = text(await renderOrganizationDeletion(data, translator("en")));
		expect(en).toContain("Organization scheduled for deletion");
		expect(en).toContain(
			"Sam scheduled the organization Acme for deletion. You can recover it until Oct 18, 2026, 14:05 (Europe/Berlin).",
		);
		expect(en).toContain("Recover organization");

		const de = text(await renderOrganizationDeletion(data, translator("de")));
		expect(de).toContain("Organisation zur Löschung vorgemerkt");
		expect(de).toContain("Endgültige Löschung");
		expect(de).toContain("Organisation wiederherstellen");

		const it_ = text(await renderOrganizationDeletion(data, translator("it")));
		expect(it_).toContain("Ripristina organizzazione");
	});

	it("renders in English without a translator (template editor preview)", async () => {
		const html = await renderPasswordReset({ userName: "Alex", resetUrl: "https://x.example" });

		expect(html).toContain('lang="en"');
		expect(html).toContain("Reset your password");
	});
});
