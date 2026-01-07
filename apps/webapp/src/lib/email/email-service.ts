import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export interface SendEmailParams {
	to: string;
	subject: string;
	html: string;
	from?: string;
	actionUrl?: string; // Optional URL for verification, reset, etc.
}

export async function sendEmail({ to, subject, html, from, actionUrl }: SendEmailParams) {
	// Without API key, log email info to console
	if (!resend) {
		console.log("\n📧 Email (no API key - logging to console):");
		console.log("━".repeat(50));
		console.log("From:", from || process.env.EMAIL_FROM || "noreply@yourdomain.com");
		console.log("To:", to);
		console.log("Subject:", subject);
		if (actionUrl) {
			console.log("\n🔗 Action URL:", actionUrl);
		}
		console.log("\nHTML Length:", html.length, "characters");
		console.log("━".repeat(50));
		return { success: true, messageId: "console-logged" };
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
