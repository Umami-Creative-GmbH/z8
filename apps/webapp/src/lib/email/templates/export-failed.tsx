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

interface ExportFailedProps {
	recipientName: string;
	organizationName: string;
	categories: string[];
	errorMessage: string;
	retryUrl: string;
}

export function ExportFailed({
	recipientName,
	organizationName,
	categories,
	errorMessage,
	retryUrl,
}: ExportFailedProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Data Export Failed</Heading>
					<Text style={text}>Hi {recipientName},</Text>
					<Text style={text}>
						Unfortunately, your data export for <strong>{organizationName}</strong> could not be
						completed.
					</Text>

					<Section style={detailsBox}>
						<Text style={detailLabel}>Organization</Text>
						<Text style={detailValue}>{organizationName}</Text>

						<Text style={detailLabel}>Requested Data</Text>
						<Text style={detailValue}>{categories.join(", ")}</Text>

						<Text style={detailLabel}>Error</Text>
						<Text style={errorValue}>{errorMessage}</Text>
					</Section>

					<Section style={buttonContainer}>
						<Button style={button} href={retryUrl}>
							Try Again
						</Button>
					</Section>

					<Hr style={hr} />

					<Text style={footer}>
						If this error persists, please contact support with the error message above.
					</Text>

					<Text style={footer}>
						You can also try exporting fewer data categories at once if you're experiencing timeout
						issues.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default ExportFailed;

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
	color: "#dc2626",
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
	backgroundColor: "#fef2f2",
	borderRadius: "8px",
	margin: "24px 40px",
	padding: "24px",
	border: "1px solid #fecaca",
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

const errorValue = {
	color: "#dc2626",
	fontSize: "14px",
	margin: "0 0 8px 0",
	fontFamily: "monospace",
	backgroundColor: "#fff",
	padding: "8px",
	borderRadius: "4px",
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
