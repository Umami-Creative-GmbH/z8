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

interface AbsenceRequestPendingApprovalProps {
	managerName: string;
	employeeName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	notes?: string;
	approvalUrl: string;
}

export function AbsenceRequestPendingApproval({
	managerName,
	employeeName,
	startDate,
	endDate,
	absenceType,
	days,
	notes,
	approvalUrl,
}: AbsenceRequestPendingApprovalProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>New Absence Request</Heading>
					<Text style={text}>Hi {managerName},</Text>
					<Text style={text}>{employeeName} has requested time off and needs your approval.</Text>

					<Section style={detailsBox}>
						<Text style={detailLabel}>Employee</Text>
						<Text style={detailValue}>{employeeName}</Text>

						<Text style={detailLabel}>Type</Text>
						<Text style={detailValue}>{absenceType}</Text>

						<Text style={detailLabel}>Dates</Text>
						<Text style={detailValue}>
							{startDate} - {endDate}
						</Text>

						<Text style={detailLabel}>Duration</Text>
						<Text style={detailValue}>{days} business days</Text>

						{notes && (
							<>
								<Text style={detailLabel}>Notes</Text>
								<Text style={detailValue}>{notes}</Text>
							</>
						)}
					</Section>

					<Section style={{ textAlign: "center" as const, margin: "32px 0" }}>
						<Button href={approvalUrl} style={button}>
							Review Request
						</Button>
					</Section>

					<Text style={text}>
						Please review and approve or reject this request at your earliest convenience.
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

export default AbsenceRequestPendingApproval;

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
