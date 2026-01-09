import {
	Body,
	Container,
	Head,
	Heading,
	Hr,
	Html,
	Link,
	Section,
	Text,
} from "@react-email/components";

interface TimeCorrectionApprovedProps {
	employeeName: string;
	approverName: string;
	date: string;
	correctedClockIn: string;
	correctedClockOut: string;
	appUrl: string;
}

export function TimeCorrectionApproved({
	employeeName,
	approverName,
	date,
	correctedClockIn,
	correctedClockOut,
	appUrl,
}: TimeCorrectionApprovedProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Time Correction Approved</Heading>
					<Text style={text}>Hi {employeeName},</Text>
					<Text style={text}>
						Great news! Your time correction request has been approved by {approverName}.
					</Text>

					<Section style={detailsBox}>
						<Text style={detailLabel}>Date</Text>
						<Text style={detailValue}>{date}</Text>

						<Text style={detailLabel}>Corrected Times</Text>
						<Text style={correctedTime}>
							{correctedClockIn} - {correctedClockOut}
						</Text>

						<Text style={detailLabel}>Status</Text>
						<Text style={statusApproved}>Approved</Text>
					</Section>

					<Text style={text}>Your timesheet has been updated with the corrected times.</Text>

					<Hr style={hr} />

					<Text style={footer}>
						<Link href={`${appUrl}/dashboard`} style={link}>
							View My Dashboard
						</Link>
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default TimeCorrectionApproved;

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
	backgroundColor: "#f0fdf4",
	borderRadius: "8px",
	margin: "24px 40px",
	padding: "24px",
	border: "1px solid #86efac",
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

const correctedTime = {
	...detailValue,
	fontFamily: "monospace",
	fontWeight: "600",
};

const statusApproved = {
	...detailValue,
	color: "#16a34a",
	fontWeight: "600",
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
