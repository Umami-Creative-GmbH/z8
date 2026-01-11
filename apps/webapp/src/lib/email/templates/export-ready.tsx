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

interface ExportReadyProps {
	recipientName: string;
	organizationName: string;
	categories: string[];
	fileSize: string;
	downloadUrl: string;
	expiresAt: string;
}

export function ExportReady({
	recipientName,
	organizationName,
	categories,
	fileSize,
	downloadUrl,
	expiresAt,
}: ExportReadyProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Your Data Export is Ready</Heading>
					<Text style={text}>Hi {recipientName},</Text>
					<Text style={text}>
						Your data export for <strong>{organizationName}</strong> has been completed and is ready
						for download.
					</Text>

					<Section style={detailsBox}>
						<Text style={detailLabel}>Organization</Text>
						<Text style={detailValue}>{organizationName}</Text>

						<Text style={detailLabel}>Data Included</Text>
						<Text style={detailValue}>{categories.join(", ")}</Text>

						<Text style={detailLabel}>File Size</Text>
						<Text style={detailValue}>{fileSize}</Text>

						<Text style={detailLabel}>Link Expires</Text>
						<Text style={detailValue}>{expiresAt}</Text>
					</Section>

					<Section style={buttonContainer}>
						<Button style={button} href={downloadUrl}>
							Download Export
						</Button>
					</Section>

					<Text style={text}>
						If the button doesn't work, you can also copy and paste this link into your browser:
					</Text>
					<Text style={linkText}>{downloadUrl}</Text>

					<Hr style={hr} />

					<Text style={footer}>
						This download link is valid for 24 hours. After that, you can generate a new link from
						the Export settings page.
					</Text>

					<Text style={footer}>
						The export file will be stored for 30 days before being automatically deleted.
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default ExportReady;

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
	backgroundColor: "#16a34a",
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
	color: "#16a34a",
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
