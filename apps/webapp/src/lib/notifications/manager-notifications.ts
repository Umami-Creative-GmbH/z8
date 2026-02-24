/**
 * Manager Assignment Notification Service
 *
 * Handles sending email notifications when managers are assigned or removed
 */

import { render } from "@react-email/components";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email/email-service";
import { ManagerAssignedEmail } from "@/lib/email/templates/manager-assigned";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ManagerNotifications");

interface ManagerAssignmentNotificationParams {
	employeeName: string;
	employeeEmail: string;
	managerName: string;
	managerEmail: string;
	isPrimary: boolean;
	assignedByName: string;
	organizationName: string;
}

/**
 * Send email notification when a manager is assigned to an employee
 */
export async function sendManagerAssignedNotification(
	params: ManagerAssignmentNotificationParams,
): Promise<void> {
	try {
		const dashboardUrl = getDefaultAppBaseUrl();

		// Render email template
		const emailHtml = await render(
			ManagerAssignedEmail({
				employeeName: params.employeeName,
				managerName: params.managerName,
				isPrimary: params.isPrimary,
				assignedByName: params.assignedByName,
				organizationName: params.organizationName,
				dashboardUrl,
			}),
		);

		// Send to employee
		await sendEmail({
			to: params.employeeEmail,
			subject: params.isPrimary
				? `${params.managerName} is now your primary manager`
				: `${params.managerName} has been assigned as your manager`,
			html: emailHtml,
		});

		// Send notification to manager as well
		const managerEmailHtml = await render(
			ManagerAssignedEmail({
				employeeName: params.employeeName,
				managerName: "You",
				isPrimary: params.isPrimary,
				assignedByName: params.assignedByName,
				organizationName: params.organizationName,
				dashboardUrl,
			}),
		);

		await sendEmail({
			to: params.managerEmail,
			subject: `You've been assigned as ${params.isPrimary ? "primary " : ""}manager for ${params.employeeName}`,
			html: managerEmailHtml,
		});

		logger.info(
			{
				employeeEmail: params.employeeEmail,
				managerEmail: params.managerEmail,
				isPrimary: params.isPrimary,
			},
			"Manager assignment notifications sent successfully",
		);
	} catch (error) {
		logger.error({ error, params }, "Failed to send manager assignment notification");
		// Don't throw - notifications are non-critical
	}
}

interface ManagerRemovalNotificationParams {
	employeeName: string;
	employeeEmail: string;
	managerName: string;
	managerEmail: string;
	removedByName: string;
	organizationName: string;
	remainingManagers: Array<{ name: string; isPrimary: boolean }>;
}

/**
 * Send email notification when a manager is removed from an employee
 */
export async function sendManagerRemovedNotification(
	params: ManagerRemovalNotificationParams,
): Promise<void> {
	try {
		const dashboardUrl = getDefaultAppBaseUrl();

		// Simple text email for removal
		const employeeEmailHtml = `
			<html>
				<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
					<h2>Manager Assignment Update</h2>
					<p>Hi ${params.employeeName},</p>
					<p><strong>${params.managerName}</strong> is no longer assigned as your manager.</p>
					${
						params.remainingManagers.length > 0
							? `
						<p>Your current managers are:</p>
						<ul>
							${params.remainingManagers
								.map((m) => `<li>${m.name}${m.isPrimary ? " <strong>(Primary)</strong>" : ""}</li>`)
								.join("")}
						</ul>
					`
							: ""
					}
					<p>This change was made by ${params.removedByName}.</p>
					<p style="margin-top: 30px;">
						<a href="${dashboardUrl}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
							View Dashboard
						</a>
					</p>
					<hr style="margin: 40px 0; border: none; border-top: 1px solid #e6ebf1;" />
					<p style="color: #8898aa; font-size: 12px;">
						This is an automated notification from ${params.organizationName}.
					</p>
				</body>
			</html>
		`;

		await sendEmail({
			to: params.employeeEmail,
			subject: `Manager assignment updated - ${params.managerName} removed`,
			html: employeeEmailHtml,
		});

		// Notify the removed manager
		const managerEmailHtml = `
			<html>
				<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
					<h2>Manager Assignment Update</h2>
					<p>Hi ${params.managerName},</p>
					<p>You are no longer assigned as a manager for <strong>${params.employeeName}</strong>.</p>
					<p>This change was made by ${params.removedByName}.</p>
					<p style="margin-top: 30px;">
						<a href="${dashboardUrl}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
							View Dashboard
						</a>
					</p>
					<hr style="margin: 40px 0; border: none; border-top: 1px solid #e6ebf1;" />
					<p style="color: #8898aa; font-size: 12px;">
						This is an automated notification from ${params.organizationName}.
					</p>
				</body>
			</html>
		`;

		await sendEmail({
			to: params.managerEmail,
			subject: `You've been removed as manager for ${params.employeeName}`,
			html: managerEmailHtml,
		});

		logger.info(
			{
				employeeEmail: params.employeeEmail,
				managerEmail: params.managerEmail,
			},
			"Manager removal notifications sent successfully",
		);
	} catch (error) {
		logger.error({ error, params }, "Failed to send manager removal notification");
		// Don't throw - notifications are non-critical
	}
}
