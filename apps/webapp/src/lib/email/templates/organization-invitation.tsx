import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Section,
	Text,
} from "@react-email/components";

interface OrganizationInvitationProps {
	email: string;
	organizationName: string;
	inviterName: string;
	role: string;
	invitationUrl: string;
}

export function OrganizationInvitation({
	email,
	organizationName,
	inviterName,
	role,
	invitationUrl,
}: OrganizationInvitationProps) {
	const roleDisplay = role.charAt(0).toUpperCase() + role.slice(1);

	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>You've Been Invited!</Heading>
					<Text style={text}>Hi there,</Text>
					<Text style={text}>
						{inviterName} has invited you to join <strong>{organizationName}</strong> as a{" "}
						<strong>{roleDisplay}</strong>.
					</Text>

					<Section style={detailsBox}>
						<Text style={detailLabel}>Organization</Text>
						<Text style={detailValue}>{organizationName}</Text>

						<Text style={detailLabel}>Your Email</Text>
						<Text style={detailValue}>{email}</Text>

						<Text style={detailLabel}>Role</Text>
						<Text style={detailValue}>{roleDisplay}</Text>

						<Text style={detailLabel}>Invited By</Text>
						<Text style={detailValue}>{inviterName}</Text>
					</Section>

					<Section style={buttonContainer}>
						<Button style={button} href={invitationUrl}>
							Accept Invitation
						</Button>
					</Section>

					<Text style={text}>
						If the button doesn't work, you can also copy and paste this link into your browser:
					</Text>
					<Text style={linkText}>{invitationUrl}</Text>

					<Hr style={hr} />

					<Text style={footer}>
						If you didn't expect this invitation, you can safely ignore this email.
					</Text>

					<Text style={footer}>This invitation link will expire in 7 days.</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default OrganizationInvitation;

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
	maxWidth: "600px",
};

const h1 = {
	color: "#333",
	fontSize: "24px",
	fontWeight: "bold",
	padding: "0 40px",
	margin: "30px 0",
	textAlign: "center" as const,
};

const text = {
	color: "#333",
	fontSize: "16px",
	lineHeight: "26px",
	padding: "0 40px",
};

const detailsBox = {
	backgroundColor: "#f6f9fc",
	borderRadius: "8px",
	margin: "24px 40px",
	padding: "24px",
};

const detailLabel = {
	color: "#666",
	fontSize: "12px",
	fontWeight: "600",
	textTransform: "uppercase" as const,
	letterSpacing: "0.5px",
	margin: "16px 0 4px 0",
};

const detailValue = {
	color: "#333",
	fontSize: "16px",
	margin: "0 0 8px 0",
};

const buttonContainer = {
	padding: "27px 40px",
	textAlign: "center" as const,
};

const button = {
	backgroundColor: "#5469d4",
	borderRadius: "6px",
	color: "#fff",
	fontSize: "16px",
	fontWeight: "600",
	textDecoration: "none",
	textAlign: "center" as const,
	display: "inline-block",
	padding: "12px 32px",
};

const linkText = {
	color: "#5469d4",
	fontSize: "14px",
	lineHeight: "24px",
	padding: "0 40px",
	wordBreak: "break-all" as const,
};

const hr = {
	borderColor: "#e6ebf1",
	margin: "20px 40px",
};

const footer = {
	color: "#8898aa",
	fontSize: "14px",
	lineHeight: "24px",
	padding: "0 40px",
	textAlign: "center" as const,
};
