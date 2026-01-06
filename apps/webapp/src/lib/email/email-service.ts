import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export interface SendEmailParams {
	to: string;
	subject: string;
	html: string;
	from?: string;
}

export async function sendEmail({ to, subject, html, from }: SendEmailParams) {
	// In development mode without API key, just log the email
	if (process.env.NODE_ENV === "development" && !resend) {
		console.log("📧 Email (dev mode):", {
			to,
			subject,
			from: from || process.env.EMAIL_FROM || "noreply@yourdomain.com",
			preview: `${html.substring(0, 100)}...`,
		});
		return { success: true, messageId: "dev-mode" };
	}

	// In production, require API key
	if (!resend) {
		console.error("RESEND_API_KEY is not configured");
		return { success: false, error: "Email service not configured" };
	}

	try {
		const result = await resend.emails.send({
			from: from || process.env.EMAIL_FROM || "noreply@yourdomain.com",
			to,
			subject,
			html,
		});

		if (result.error) {
			console.error("Email send error:", result.error);
			return { success: false, error: result.error.message };
		}

		return { success: true, messageId: result.data?.id };
	} catch (error) {
		console.error("Email send exception:", error);
		return { success: false, error: "Failed to send email" };
	}
}

/**
 * Send email to multiple recipients
 */
export async function sendBulkEmail(
	recipients: string[],
	subject: string,
	html: string,
	from?: string,
) {
	const results = await Promise.allSettled(
		recipients.map((to) => sendEmail({ to, subject, html, from })),
	);

	const successful = results.filter((r) => r.status === "fulfilled").length;
	const failed = results.filter((r) => r.status === "rejected").length;

	return { successful, failed, total: recipients.length };
}
