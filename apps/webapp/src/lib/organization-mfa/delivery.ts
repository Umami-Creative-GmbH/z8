import "server-only";
import { and, eq, isNull, lte } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { member, organization, user } from "@/db/auth-schema";
import {
	organizationMfaNotice,
	organizationMfaPolicy,
	organizationMfaWindow,
} from "@/db/schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { loadEmailTranslator } from "@/lib/email/email-i18n";
import { sendEmail } from "@/lib/email/email-service";
import { renderNotificationEmail } from "@/lib/email/render";
import { insertInAppNotification } from "@/lib/notifications/notification-service";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import { formatMfaDeadline } from "./notices";
import { materializeMfaWindow } from "./store";

/** Required channels deliberately bypass optional notification preferences and template overrides. */
export async function deliverMfaNotices() {
	const windows = await db
		.select({
			organizationId: organizationMfaWindow.organizationId,
			userId: organizationMfaWindow.userId,
		})
		.from(organizationMfaWindow)
		.where(isNull(organizationMfaWindow.deadline));
	for (const window of windows)
		await materializeMfaWindow(window.organizationId, window.userId);
	const now = systemClock.nowInstant();
	const due = await db
		.select({ id: organizationMfaNotice.id })
		.from(organizationMfaNotice)
		.where(
			and(
				isNull(organizationMfaNotice.sentAt),
				lte(organizationMfaNotice.dueAt, dateFromInstant(now)),
			),
		)
		.limit(100);
	let sent = 0,
		failed = 0;
	for (const { id } of due)
		await db.transaction(async (tx) => {
			const [notice] = await tx
				.select()
				.from(organizationMfaNotice)
				.where(
					and(
						eq(organizationMfaNotice.id, id),
						isNull(organizationMfaNotice.sentAt),
					),
				)
				.for("update", { skipLocked: true });
			if (!notice) return;
			const [scope] = await tx
				.select({
					name: organization.name,
					timezone: organization.timezone,
					email: user.email,
					enabled: organizationMfaPolicy.enabled,
				})
				.from(member)
				.innerJoin(organization, eq(organization.id, member.organizationId))
				.innerJoin(user, eq(user.id, member.userId))
				.innerJoin(
					organizationMfaPolicy,
					eq(organizationMfaPolicy.organizationId, member.organizationId),
				)
				.where(
					and(
						eq(member.organizationId, notice.organizationId),
						eq(member.userId, notice.userId),
					),
				);
			const reminder =
				notice.kind === "three-days" || notice.kind === "one-day";
			if (
				!scope ||
				(reminder &&
					(!scope.enabled ||
						!notice.payload.deadline ||
						Temporal.Instant.compare(
							Temporal.Instant.from(notice.payload.deadline),
							now,
						) <= 0))
			) {
				await tx
					.update(organizationMfaNotice)
					.set({ sentAt: dateFromInstant(now) })
					.where(eq(organizationMfaNotice.id, id));
				return;
			}
			const locale = await resolveRecipientNotificationLocale({
				userId: notice.userId,
				organizationId: notice.organizationId,
			});
			const { t } = await loadEmailTranslator(locale);
			const deadline = notice.payload.deadline
				? formatMfaDeadline(notice.payload.deadline, scope.timezone, locale)
				: "";
			const security = notice.kind === "security";
			const title = security
				? t("emails.mfa.securityTitle", "Authentication security changed")
				: t("emails.mfa.deadlineTitle", "Organization authentication required");
			const eventLabel =
				notice.payload.event === "password_changed"
					? t("emails.mfa.passwordChanged", "Password changed")
					: notice.payload.event === "recovery_codes_changed"
						? t("emails.mfa.codesChanged", "Recovery code used or replaced")
						: notice.payload.event?.endsWith("delete")
							? t("emails.mfa.factorRemoved", "Authenticator removed")
							: t("emails.mfa.factorChanged", "Authenticator changed");
			let message = security
				? t(
						"emails.mfa.securityMessage",
						"{event} for {organization}. Prior verification may no longer permit organization access. Verify a remaining or replacement authenticator at Security verification. If you did not make this change, secure your account now.",
						{ event: eventLabel, organization: scope.name },
					)
				: t(
						"emails.mfa.deadlineMessage",
						"{organization} requires an authenticator by {deadline}. After this exact deadline, verify a TOTP authenticator or a passkey with PIN/biometrics before accessing this organization. Enrollment alone is insufficient. Use Security verification to enroll or verify; password plus a backup code permits replacement enrollment only.",
						{ organization: scope.name, deadline },
					);
			if (!scope.enabled && !security)
				message += ` ${t("emails.mfa.suspended", "The requirement is currently suspended. Re-enabling it restores the assigned deadline.")}`;
			const localized = { locale, title, message };
			const actionUrl = `/mfa?organizationId=${encodeURIComponent(notice.organizationId)}`;
			await insertInAppNotification(
				{
					organizationId: notice.organizationId,
					userId: notice.userId,
					type: "organization_mfa_notice",
					title: localized.title,
					message: localized.message,
					actionUrl,
					idempotencyKey: `mfa:${id}`,
				},
				tx,
			);
			try {
				const { locale, t } = await loadEmailTranslator(localized.locale);
				const result = await sendEmail(
					{
						to: scope.email,
						idempotencyKey: `mfa-${id}`,
						subject: localized.title,
						html: await renderNotificationEmail({
							locale,
							t,
							title: localized.title,
							message: localized.message,
							actionUrl: new URL(
								actionUrl,
								await getOrganizationBaseUrl(notice.organizationId),
							).href,
						}),
						organizationId: notice.organizationId,
					},
					{ durable: true },
				);
				if (!result.success) {
					failed++;
					return;
				}
				await tx
					.update(organizationMfaNotice)
					.set({ sentAt: dateFromInstant(now) })
					.where(eq(organizationMfaNotice.id, id));
				sent++;
			} catch {
				failed++;
			}
		});
	return { sent, failed };
}
