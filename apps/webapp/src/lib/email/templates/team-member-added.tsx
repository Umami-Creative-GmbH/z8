import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Link,
	Section,
	Text,
} from "@react-email/components";

interface TeamMemberAddedProps {
	memberName: string;
	teamName: string;
	addedByName: string;
	teamUrl: string;
	appUrl: string;
}

export function TeamMemberAdded({
	memberName,
	teamName,
	addedByName,
	teamUrl,
	appUrl,
}: TeamMemberAddedProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Welcome to the Team!</Heading>
					<Text style={text}>Hi {memberName},</Text>
					<Text style={text}>You've been added to a new team by {addedByName}.</Text>

					<Section style={detailsBox}>
						<Text style={detailLabel}>Team</Text>
						<Text style={teamNameStyle}>{teamName}</Text>

						<Text style={detailLabel}>Added By</Text>
						<Text style={detailValue}>{addedByName}</Text>
					</Section>

					<Text style={text}>
						You can now collaborate with your team members and access team resources.
					</Text>

					<Section style={{ textAlign: "center" as const, margin: "32px 0" }}>
						<Button href={teamUrl} style={button}>
							View Team
						</Button>
					</Section>

					<Hr style={hr} />

					<Text style={footer}>
						<Link href={appUrl} style={link}>
							Go to Dashboard
						</Link>
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default TeamMemberAdded;

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
	backgroundColor: "#eff6ff",
	borderRadius: "8px",
	margin: "24px 40px",
	padding: "24px",
	border: "1px solid #93c5fd",
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

const teamNameStyle = {
	...detailValue,
	color: "#2563eb",
	fontWeight: "600",
	fontSize: "18px",
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

const link = {
	color: "#5469d4",
	textDecoration: "underline",
};
