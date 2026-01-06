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

interface AbsenceRequestRejectedProps {
	employeeName: string;
	approverName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	rejectionReason: string;
	appUrl: string;
}

export function AbsenceRequestRejected({
	employeeName,
	approverName,
	startDate,
	endDate,
	absenceType,
	days,
	rejectionReason,
	appUrl,
}: AbsenceRequestRejectedProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Absence Request Update</Heading>
					<Text style={text}>Hi {employeeName},</Text>
					<Text style={text}>
						Your absence request has been reviewed by {approverName} and could not be approved at
						this time.
					</Text>

					<Section style={detailsBox}>
						<Text style={detailLabel}>Type</Text>
						<Text style={detailValue}>{absenceType}</Text>

						<Text style={detailLabel}>Dates</Text>
						<Text style={detailValue}>
							{startDate} - {endDate}
						</Text>

						<Text style={detailLabel}>Duration</Text>
						<Text style={detailValue}>{days} business days</Text>

						<Text style={detailLabel}>Status</Text>
						<Text style={statusRejected}>Not Approved</Text>

						<Text style={detailLabel}>Reason</Text>
						<Text style={reasonText}>{rejectionReason}</Text>
					</Section>

					<Text style={text}>
						If you have questions about this decision, please reach out to {approverName} directly.
					</Text>

					<Hr style={hr} />

					<Text style={footer}>
						<Link href={`${appUrl}/absences`} style={link}>
							View My Absences
						</Link>
					</Text>
				</Container>
			</Body>
		</Html>
	);
}

export default AbsenceRequestRejected;

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

const statusRejected = {
	...detailValue,
	color: "#dc2626",
	fontWeight: "600",
};

const reasonText = {
	...detailValue,
	fontStyle: "italic",
	backgroundColor: "#fff",
	padding: "12px",
	borderRadius: "4px",
	border: "1px solid #fecaca",
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
