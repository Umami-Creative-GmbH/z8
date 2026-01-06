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

interface AbsenceRequestSubmittedProps {
	employeeName: string;
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	managerName: string;
	appUrl: string;
}

export function AbsenceRequestSubmitted({
	employeeName,
	startDate,
	endDate,
	absenceType,
	days,
	managerName,
	appUrl,
}: AbsenceRequestSubmittedProps) {
	return (
		<Html>
			<Head />
			<Body style={main}>
				<Container style={container}>
					<Heading style={h1}>Absence Request Submitted</Heading>
					<Text style={text}>Hi {employeeName},</Text>
					<Text style={text}>
						Your absence request has been submitted and is awaiting approval from {managerName}.
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
						<Text style={statusPending}>Pending Approval</Text>
					</Section>

					<Text style={text}>
						You'll receive a notification once your manager reviews your request.
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

export default AbsenceRequestSubmitted;

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

const statusPending = {
	...detailValue,
	color: "#f59e0b",
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
