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

interface TimeCorrectionPendingApprovalProps {
	managerName: string;
	employeeName: string;
	date: string;
	originalClockIn: string;
	originalClockOut: string;
	correctedClockIn: string;
	correctedClockOut: string;
	reason: string;
	approvalUrl: string;
}

export function TimeCorrectionPendingApproval({
	managerName,
	employeeName,
	date,
	originalClockIn,
	originalClockOut,
	correctedClockIn,
	correctedClockOut,
	reason,
	approvalUrl,
}: TimeCorrectionPendingApprovalProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Time Correction Request</Heading>
					<Text style={text}>Hi {managerName},</Text>
					<Text style={text}>
						{employeeName} has requested a time correction and needs your approval.
					</Text>

					<Section style={detailsBox}>
						<Text style={detailLabel}>Employee</Text>
						<Text style={detailValue}>{employeeName}</Text>

						<Text style={detailLabel}>Date</Text>
						<Text style={detailValue}>{date}</Text>

						<Text style={detailLabel}>Original Times</Text>
						<Text style={originalTime}>
							{originalClockIn} → {originalClockOut}
						</Text>

						<Text style={detailLabel}>Corrected Times</Text>
						<Text style={correctedTime}>
							{correctedClockIn} → {correctedClockOut}
						</Text>

						<Text style={detailLabel}>Reason</Text>
						<Text style={reasonText}>{reason}</Text>
					</Section>

					<Section style={{ textAlign: "center" as const, margin: "32px 0" }}>
						<Button href={approvalUrl} style={button}>
							Review Correction
						</Button>
					</Section>

					<Text style={text}>
						Please review and approve or reject this time correction at your earliest convenience.
					</Text>

					<Hr style={hr} />

					<Text style={footer}>
						<Link href={approvalUrl} style={link}>
							Go to Approvals Dashboard
						</Link>
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default TimeCorrectionPendingApproval;

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

const originalTime = {
	...detailValue,
	color: "#666",
	fontFamily: "monospace",
	textDecoration: "line-through",
};

const correctedTime = {
	...detailValue,
	color: "#f59e0b",
	fontFamily: "monospace",
	fontWeight: "600",
};

const reasonText = {
	...detailValue,
	fontStyle: "italic",
	backgroundColor: "#fff",
	padding: "12px",
	borderRadius: "4px",
	border: "1px solid #e6ebf1",
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
