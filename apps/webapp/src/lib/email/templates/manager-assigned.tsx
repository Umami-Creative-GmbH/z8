/**
 * Email template for manager assignment notification
 */

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

interface ManagerAssignedEmailProps {
	employeeName: string;
	managerName: string;
	isPrimary: boolean;
	assignedByName: string;
	organizationName: string;
	dashboardUrl: string;
}

export function ManagerAssignedEmail({
	employeeName = "John Doe",
	managerName = "Jane Smith",
	isPrimary = true,
	assignedByName = "Admin User",
	organizationName = "Acme Corp",
	dashboardUrl = "https://app.example.com",
}: ManagerAssignedEmailProps) {
	const previewText = `${managerName} has been assigned as your ${isPrimary ? "primary " : ""}manager`;

	return (
		<Html>
			<Head />
			<Preview>{previewText}</Preview>
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Manager Assignment</Heading>

					<Text style={text}>Hi {employeeName},</Text>

					<Text style={text}>
						<strong>{managerName}</strong> has been assigned as your{" "}
						{isPrimary ? <strong>primary manager</strong> : "manager"} by{" "}
						{assignedByName}.
					</Text>

					{isPrimary && (
						<Text style={highlightText}>
							As your primary manager, {managerName} will be the default
							approver for your time-off requests and other approvals.
						</Text>
					)}

					<Section style={buttonContainer}>
						<Button style={button} href={dashboardUrl}>
							View Dashboard
						</Button>
					</Section>

					<Hr style={hr} />

					<Text style={footer}>
						This is an automated notification from {organizationName}. If you
						have any questions, please contact your administrator.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default ManagerAssignedEmail;

// Styles
const main = {
	backgroundColor: "#f6f9fc",
	fontFamily:
		'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
	backgroundColor: "#ffffff",
	margin: "0 auto",
	padding: "20px 0 48px",
	marginBottom: "64px",
};

const h1 = {
	color: "#333",
	fontSize: "24px",
	fontWeight: "bold",
	margin: "40px 0",
	padding: "0",
	textAlign: "center" as const,
};

const text = {
	color: "#333",
	fontSize: "16px",
	lineHeight: "26px",
	margin: "16px 0",
	padding: "0 40px",
};

const highlightText = {
	...text,
	backgroundColor: "#f0f9ff",
	borderLeft: "4px solid #3b82f6",
	padding: "16px 40px",
	margin: "24px 0",
};

const buttonContainer = {
	padding: "27px 0 27px",
	textAlign: "center" as const,
};

const button = {
	backgroundColor: "#3b82f6",
	borderRadius: "5px",
	color: "#fff",
	fontSize: "16px",
	fontWeight: "bold",
	textDecoration: "none",
	textAlign: "center" as const,
	display: "block",
	width: "200px",
	padding: "14px 7px",
	margin: "0 auto",
};

const hr = {
	borderColor: "#e6ebf1",
	margin: "20px 0",
};

const footer = {
	color: "#8898aa",
	fontSize: "12px",
	lineHeight: "16px",
	padding: "0 40px",
	margin: "24px 0",
};
