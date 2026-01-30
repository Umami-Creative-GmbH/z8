import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Img,
	Link,
	Preview,
	Section,
	Text,
} from "@react-email/components";

interface OrganizationDeletionProps {
	userName: string;
	organizationName: string;
	deletedByName: string;
	deletionDate: string;
	permanentDeletionDate: string;
	recoveryUrl: string;
	appUrl: string;
}

export function OrganizationDeletion({
	userName,
	organizationName,
	deletedByName,
	deletionDate,
	permanentDeletionDate,
	recoveryUrl,
	appUrl,
}: OrganizationDeletionProps) {
	return (
		<Html>
			<Head />
			<Preview>
				Organization "{organizationName}" scheduled for deletion - 5 days to recover
			</Preview>
			<Body style={main}>
				<Container style={container}>
					{/* Header with warning icon */}
					<Section style={headerSection}>
						<div style={iconWrapper}>
							<Text style={iconText}>⚠️</Text>
						</div>
						<Heading style={h1}>Organization Scheduled for Deletion</Heading>
						<Text style={subtitle}>Action required within 5 days</Text>
					</Section>

					<Section style={contentSection}>
						<Text style={greeting}>Hi {userName},</Text>
						<Text style={text}>
							The organization <strong style={orgName}>{organizationName}</strong> has been
							scheduled for deletion by <strong>{deletedByName}</strong>.
						</Text>

						{/* Warning countdown box */}
						<Section style={countdownBox}>
							<Text style={countdownLabel}>Permanent deletion scheduled for</Text>
							<Text style={countdownDate}>{permanentDeletionDate}</Text>
							<Text style={countdownNote}>5 days remaining to recover</Text>
						</Section>

						{/* Details section */}
						<Section style={detailsBox}>
							<table style={detailsTable} cellPadding="0" cellSpacing="0">
								<tbody>
									<tr>
										<td style={detailCell}>
											<Text style={detailLabel}>Organization</Text>
											<Text style={detailValue}>{organizationName}</Text>
										</td>
									</tr>
									<tr>
										<td style={detailCell}>
											<Text style={detailLabel}>Initiated by</Text>
											<Text style={detailValue}>{deletedByName}</Text>
										</td>
									</tr>
									<tr>
										<td style={detailCell}>
											<Text style={detailLabel}>Deletion requested</Text>
											<Text style={detailValue}>{deletionDate}</Text>
										</td>
									</tr>
								</tbody>
							</table>
						</Section>

						{/* What will be deleted */}
						<Section style={warningSection}>
							<Text style={warningTitle}>What will be permanently deleted:</Text>
							<ul style={warningList}>
								<li style={warningItem}>All organization members and pending invitations</li>
								<li style={warningItem}>All employees, teams, and manager assignments</li>
								<li style={warningItem}>All time entries and work periods</li>
								<li style={warningItem}>All absences and vacation allowances</li>
								<li style={warningItem}>All projects and time assignments</li>
								<li style={warningItem}>All settings, schedules, and configurations</li>
							</ul>
						</Section>

						{/* Recovery CTA */}
						<Section style={ctaSection}>
							<Text style={ctaText}>
								If this was a mistake, you can cancel the deletion and recover all data:
							</Text>
							<Button href={recoveryUrl} style={primaryButton}>
								Recover Organization
							</Button>
						</Section>

						<Hr style={hr} />

						{/* Footer note */}
						<Text style={footerNote}>
							If you initiated this deletion and want it to proceed, no action is needed. The
							organization will be permanently deleted on {permanentDeletionDate}.
						</Text>

						<Text style={securityNote}>
							If you did not request this deletion, please{" "}
							<Link href={recoveryUrl} style={urgentLink}>
								recover the organization immediately
							</Link>{" "}
							and review your account security.
						</Text>
					</Section>

					{/* Footer */}
					<Section style={footerSection}>
						<Text style={footerText}>
							<Link href={appUrl} style={footerLink}>
								Go to Dashboard
							</Link>
							{" · "}
							<Link href={`${appUrl}/settings/security`} style={footerLink}>
								Security Settings
							</Link>
						</Text>
					</Section>
				</Container>
			</Body>
		</Html>
	);
}

export default OrganizationDeletion;

// Styles
const main = {
	backgroundColor: "#f6f9fc",
	fontFamily:
		'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
	padding: "40px 0",
};

const container = {
	backgroundColor: "#ffffff",
	margin: "0 auto",
	maxWidth: "600px",
	borderRadius: "12px",
	overflow: "hidden",
	boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
};

const headerSection = {
	backgroundColor: "#fef2f2",
	borderBottom: "3px solid #dc2626",
	padding: "32px 40px",
	textAlign: "center" as const,
};

const iconWrapper = {
	width: "64px",
	height: "64px",
	backgroundColor: "#fee2e2",
	borderRadius: "50%",
	margin: "0 auto 16px auto",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
};

const iconText = {
	fontSize: "32px",
	lineHeight: "64px",
	textAlign: "center" as const,
	margin: "0",
};

const h1 = {
	color: "#991b1b",
	fontSize: "24px",
	fontWeight: "700",
	margin: "0 0 8px 0",
	lineHeight: "1.3",
};

const subtitle = {
	color: "#dc2626",
	fontSize: "14px",
	fontWeight: "600",
	margin: "0",
	textTransform: "uppercase" as const,
	letterSpacing: "0.5px",
};

const contentSection = {
	padding: "32px 40px",
};

const greeting = {
	color: "#1f2937",
	fontSize: "16px",
	lineHeight: "1.5",
	margin: "0 0 16px 0",
};

const text = {
	color: "#4b5563",
	fontSize: "16px",
	lineHeight: "1.6",
	margin: "0 0 24px 0",
};

const orgName = {
	color: "#111827",
	fontWeight: "600",
};

const countdownBox = {
	backgroundColor: "#fef2f2",
	borderRadius: "12px",
	border: "2px solid #fecaca",
	padding: "24px",
	textAlign: "center" as const,
	margin: "0 0 24px 0",
};

const countdownLabel = {
	color: "#991b1b",
	fontSize: "12px",
	fontWeight: "600",
	textTransform: "uppercase" as const,
	letterSpacing: "0.5px",
	margin: "0 0 8px 0",
};

const countdownDate = {
	color: "#dc2626",
	fontSize: "20px",
	fontWeight: "700",
	margin: "0 0 8px 0",
};

const countdownNote = {
	color: "#b91c1c",
	fontSize: "14px",
	fontWeight: "500",
	margin: "0",
};

const detailsBox = {
	backgroundColor: "#f9fafb",
	borderRadius: "8px",
	padding: "20px",
	margin: "0 0 24px 0",
};

const detailsTable = {
	width: "100%",
};

const detailCell = {
	padding: "8px 0",
	borderBottom: "1px solid #e5e7eb",
};

const detailLabel = {
	color: "#6b7280",
	fontSize: "12px",
	fontWeight: "600",
	textTransform: "uppercase" as const,
	letterSpacing: "0.5px",
	margin: "0 0 4px 0",
};

const detailValue = {
	color: "#111827",
	fontSize: "14px",
	fontWeight: "500",
	margin: "0",
};

const warningSection = {
	margin: "0 0 32px 0",
};

const warningTitle = {
	color: "#374151",
	fontSize: "14px",
	fontWeight: "600",
	margin: "0 0 12px 0",
};

const warningList = {
	color: "#6b7280",
	fontSize: "14px",
	lineHeight: "1.6",
	margin: "0",
	paddingLeft: "20px",
};

const warningItem = {
	marginBottom: "6px",
};

const ctaSection = {
	backgroundColor: "#ecfdf5",
	borderRadius: "12px",
	padding: "24px",
	textAlign: "center" as const,
	margin: "0 0 24px 0",
};

const ctaText = {
	color: "#065f46",
	fontSize: "14px",
	margin: "0 0 16px 0",
};

const primaryButton = {
	backgroundColor: "#059669",
	borderRadius: "8px",
	color: "#ffffff",
	fontSize: "16px",
	fontWeight: "600",
	textDecoration: "none",
	textAlign: "center" as const,
	display: "inline-block",
	padding: "14px 32px",
};

const hr = {
	borderColor: "#e5e7eb",
	margin: "24px 0",
};

const footerNote = {
	color: "#6b7280",
	fontSize: "14px",
	lineHeight: "1.5",
	margin: "0 0 16px 0",
};

const securityNote = {
	color: "#4b5563",
	fontSize: "13px",
	lineHeight: "1.5",
	margin: "0",
	padding: "12px 16px",
	backgroundColor: "#fffbeb",
	borderRadius: "6px",
	border: "1px solid #fcd34d",
};

const urgentLink = {
	color: "#dc2626",
	fontWeight: "600",
};

const footerSection = {
	backgroundColor: "#f9fafb",
	padding: "20px 40px",
	textAlign: "center" as const,
};

const footerText = {
	color: "#9ca3af",
	fontSize: "13px",
	margin: "0",
};

const footerLink = {
	color: "#6b7280",
	textDecoration: "none",
};
