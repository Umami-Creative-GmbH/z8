import {
	Document,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer";
import type { DrivingLicenceHistory } from "./history";

const styles = StyleSheet.create({
	page: {
		paddingTop: 38,
		paddingBottom: 48,
		paddingHorizontal: 40,
		fontFamily: "Helvetica",
		fontSize: 9,
		lineHeight: 1.4,
		color: "#172033",
	},
	title: { fontSize: 21, color: "#1d4ed8", marginBottom: 8 },
	heading: { fontSize: 13, marginTop: 16, marginBottom: 7, color: "#1e40af" },
	block: {
		marginBottom: 10,
		padding: 10,
		borderWidth: 1,
		borderColor: "#dbe3ef",
	},
	label: { fontFamily: "Helvetica-Bold", marginBottom: 3 },
	context: { color: "#64748b", fontSize: 8, marginBottom: 4 },
	footer: {
		position: "absolute",
		top: 805,
		left: 40,
		width: 515,
		fontSize: 8,
		lineHeight: 1,
		color: "#64748b",
	},
});
const yes = (value: boolean) => (value ? "Confirmed" : "Not confirmed");
const context = (inPeriod: boolean) =>
	inPeriod
		? "In selected period"
		: "Earlier context supporting the selected period";
export async function renderDrivingLicenceEvidencePdf(
	history: DrivingLicenceHistory,
	generatedAt: string,
	actorNames: ReadonlyMap<string, string>,
) {
	return renderToBuffer(
		<Document title="Driving licence inspection evidence" author="Z8">
			<Page size="A4" style={styles.page}>
				<Text
					fixed
					style={styles.footer}
					render={({ pageNumber, totalPages }) =>
						`Z8 | Confidential employee evidence | ${pageNumber} / ${totalPages}`
					}
				/>
				<Text style={styles.title}>Driving licence inspection evidence</Text>
				<Text>
					Employee: {history.checks[0]?.employeeName ?? history.employeeId}
				</Text>
				<Text>
					From (inclusive): {history.period.from ?? "All retained history"}
				</Text>
				<Text>
					Before (exclusive): {history.period.to ?? "No end selected"}
				</Text>
				<Text>
					Generated: {generatedAt}. All event times and period boundaries use
					UTC.
				</Text>
				<Text style={styles.context}>
					Original records and later supplements remain separate. Earlier
					context explains authorization carried into this period. This is
					historical evidence, not a current permission to drive.
				</Text>
				<Text style={styles.heading} minPresenceAhead={65}>
					Original checks
				</Text>
				{history.checks.length === 0 ? (
					<Text>No checks in this period or its supporting context.</Text>
				) : null}
				{history.checks.map((check) => (
					<View key={check.id} style={styles.block}>
						<Text style={styles.label}>Check {check.id}</Text>
						<Text style={styles.context}>{context(check.inPeriod)}</Text>
						<Text>
							Controlled: {check.controlledAt} | Verifier: {check.verifierName}
						</Text>
						<Text>
							Document issued: {check.documentIssuedOn} | Document expires:{" "}
							{check.documentExpiresOn}
						</Text>
						<Text>
							Original personally inspected: {yes(check.originalInspected)}
						</Text>
						<Text>Identity matched: {yes(check.identityConfirmed)}</Text>
						<Text>Employee declaration: {yes(check.employeeDeclaration)}</Text>
						<Text>{check.declarationText}</Text>
						<Text>Verifier confirmation: {yes(check.verifierConfirmed)}</Text>
						<Text>Failure scope: {check.failureScope}</Text>
						<Text>
							Policy version {check.policyVersion}; interval{" "}
							{check.intervalMonths} months; deadline zone{" "}
							{check.deadlineTimezone}
						</Text>
						{check.classes.map((c) => (
							<Text key={c.code}>
								Class {c.code}: {c.result}; class expiry:{" "}
								{c.expiryDate ?? "None recorded"}; restrictions:{" "}
								{c.restrictions || "None recorded"}
							</Text>
						))}
					</View>
				))}
				<Text style={styles.heading} minPresenceAhead={65}>
					Dated supplements
				</Text>
				{history.supplements.length === 0 ? (
					<Text>No supplements in this period or its supporting context.</Text>
				) : null}
				{history.supplements.map((s) => (
					<View key={s.id} style={styles.block} wrap={false}>
						<Text style={styles.label}>Supplement {s.id}</Text>
						<Text style={styles.context}>{context(s.inPeriod)}</Text>
						<Text>Check: {s.checkId}</Text>
						<Text>
							Recorded: {s.recordedAt} | Author: {s.authorName}
						</Text>
						<Text>Reason: {s.reason}</Text>
						<Text>
							Correction: {s.correction.field}
							{"classCode" in s.correction
								? ` (class ${s.correction.classCode})`
								: ""}
							: {s.correction.value ?? "None recorded"}
						</Text>
					</View>
				))}
				<Text style={styles.heading} minPresenceAhead={65}>
					Authorization, reports and resolutions
				</Text>
				{history.events.length === 0 ? (
					<Text>
						No authorization events in this period or its supporting context.
					</Text>
				) : null}
				{history.events.map((e) => (
					<View key={e.id} style={styles.block} wrap={false}>
						<Text style={styles.label}>
							{e.kind} -{" "}
							{e.classCode ? `class ${e.classCode}` : "Person / document"}
						</Text>
						<Text style={styles.context}>{context(e.inPeriod)}</Text>
						<Text>Event: {e.id}</Text>
						<Text>
							Effective: {e.effectiveAt} | Recorded: {e.recordedAt}
						</Text>
						<Text>
							Actor:{" "}
							{e.actorUserId
								? (actorNames.get(e.actorUserId) ?? "Unknown actor")
								: "System"}
						</Text>
						<Text>Reason / linked report: {e.reason ?? "None recorded"}</Text>
						<Text>Supporting check: {e.checkId ?? "None"}</Text>
					</View>
				))}
				<Text style={styles.heading} minPresenceAhead={65}>
					Applicable policy context
				</Text>
				{history.policies.length === 0 ? (
					<Text>No referenced policy revisions.</Text>
				) : null}
				{history.policies.map((p) => (
					<View key={p.version} style={styles.block}>
						<Text>
							Version {p.version}; routine interval: {p.intervalMonths} months;
							calendar zone: {p.timezone}
						</Text>
						<Text>
							Changed: {p.changedAt} | Actor:{" "}
							{actorNames.get(p.changedBy) ?? "Unknown actor"}
						</Text>
					</View>
				))}
				<Text style={styles.context}>
					Only retained evidence is included. Generating this PDF does not
					extend the organization's retention or create a stored application
					archive.
				</Text>
			</Page>
		</Document>,
	);
}
