import Image from "next/image";
import Link from "next/link";

export default function DesignM2() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Newsreader', 'Lora', 'Source Serif 4', Georgia, serif",
				backgroundColor: "#fefefe",
				color: "#111111",
			}}
		>
			{/* Header — ultra minimal */}
			<header className="relative z-20 flex items-center justify-between px-8 py-6 lg:px-16">
				<div className="flex items-center gap-6">
					<span className="text-[20px] font-bold tracking-[-0.02em]" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>
						Z8
					</span>
					<nav className="hidden items-center gap-6 text-[14px] text-[#888] md:flex" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>
						<a href="#features" className="transition-colors hover:text-[#111]">Produkt</a>
						<a href="#features" className="transition-colors hover:text-[#111]">Kunden</a>
						<a href="#contact" className="transition-colors hover:text-[#111]">Preise</a>
					</nav>
				</div>
				<div className="flex items-center gap-3" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>
					<a href="#contact" className="rounded-lg px-5 py-2.5 text-[14px] text-[#666] transition-colors hover:text-[#111]" style={{ border: "1px solid #e0e0e0" }}>
						Anmelden
					</a>
					<a
						href="#contact"
						className="rounded-lg px-5 py-2.5 text-[14px] font-semibold text-white transition-all hover:opacity-90"
						style={{ backgroundColor: "#111" }}
					>
						Kostenlos starten
					</a>
				</div>
			</header>

			{/* Hero — centered giant serif */}
			<section className="relative z-10 px-8 pb-8 pt-24 lg:px-16">
				<div className="mx-auto max-w-4xl text-center">
					{/* Announcement pill */}
					<div
						className="animate-fade-up mx-auto mb-10 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px]"
						style={{
							backgroundColor: "#f5f5f5",
							border: "1px solid #eee",
							animationDelay: "0.05s",
							fontFamily: "'Outfit', 'Manrope', sans-serif",
						}}
					>
						<span className="rounded-full bg-[#111] px-2 py-0.5 text-[10px] font-bold text-white">Neu</span>
						<span className="text-[#666]">Echtzeit-Analyse jetzt verf&uuml;gbar</span>
						<span className="text-[#ccc]">&rsaquo;</span>
					</div>

					<h1
						className="animate-fade-up"
						style={{
							fontSize: "clamp(3.5rem, 8vw, 6.5rem)",
							fontWeight: 600,
							lineHeight: 1.05,
							letterSpacing: "-0.03em",
							animationDelay: "0.15s",
						}}
					>
						Zeiterfassung
						<br />
						neu gedacht.
					</h1>

					<p
						className="animate-fade-up mx-auto mt-8 max-w-lg text-[18px] leading-[1.7] text-[#888]"
						style={{
							animationDelay: "0.3s",
							fontFamily: "'Outfit', 'Manrope', sans-serif",
						}}
					>
						Pr&auml;zise, flexibel und datengetrieben &mdash; Z8 macht es
						einfach, genau die Zeiterfassung zu bauen, die Ihr Unternehmen braucht.
					</p>

					<div
						className="animate-fade-up mt-10 flex items-center justify-center gap-3"
						style={{ animationDelay: "0.45s", fontFamily: "'Outfit', 'Manrope', sans-serif" }}
					>
						<a
							href="#contact"
							className="rounded-lg px-7 py-3.5 text-[15px] font-semibold text-white transition-all hover:opacity-90"
							style={{ backgroundColor: "#111" }}
						>
							Kostenlos starten
						</a>
						<a
							href="#contact"
							className="rounded-lg px-7 py-3.5 text-[15px] text-[#666] transition-colors hover:text-[#111]"
							style={{ border: "1px solid #ddd" }}
						>
							Demo anfragen
						</a>
					</div>
				</div>
			</section>

			{/* Product screenshot rising from bottom */}
			<section className="relative z-10 mx-8 mt-16 lg:mx-16">
				<div className="animate-scale-in mx-auto max-w-5xl" style={{ animationDelay: "0.6s" }}>
					<div
						className="relative overflow-hidden rounded-t-2xl"
						style={{
							boxShadow: "0 -8px 60px rgba(0,0,0,0.08), 0 -2px 20px rgba(0,0,0,0.04)",
							border: "1px solid #e8e8e8",
							borderBottom: "none",
						}}
					>
						{/* Window chrome */}
						<div className="flex items-center gap-2 bg-[#f8f8f8] px-4 py-3" style={{ borderBottom: "1px solid #eee" }}>
							<div className="flex gap-1.5">
								<div className="h-3 w-3 rounded-full bg-[#ff5f56]" />
								<div className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
								<div className="h-3 w-3 rounded-full bg-[#27ca40]" />
							</div>
							<div className="ml-4 flex-1">
								<div className="mx-auto max-w-xs rounded-md bg-[#f0f0f0] px-4 py-1.5 text-center text-[11px] text-[#999]">
									z8.app/dashboard
								</div>
							</div>
						</div>
						{/* Simulated app */}
						<div className="flex" style={{ backgroundColor: "#fff", minHeight: "340px" }}>
							{/* Sidebar */}
							<div className="hidden w-56 border-r border-[#f0f0f0] p-4 md:block" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>
								<div className="mb-6 flex items-center gap-2.5">
									<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#111] text-[10px] font-bold text-white">Z8</div>
									<div>
										<div className="text-[12px] font-semibold">Basepoint</div>
										<div className="text-[10px] text-[#bbb]">Enterprise</div>
									</div>
								</div>
								<div className="mb-1 flex items-center gap-2 rounded-lg bg-[#f5f5f5] px-3 py-2 text-[12px] font-medium">
									<span className="text-[14px]">&#9776;</span> Dashboard
								</div>
								{["Stempeluhr", "Mitarbeiter", "Berichte", "Lohnexport", "Schichten"].map((item, i) => (
									<div key={i} className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#999]">
										<span className="text-[14px] text-[#ccc]">&#9675;</span> {item}
									</div>
								))}
								<div className="mx-3 my-3 h-px bg-[#f0f0f0]" />
								<div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#ccc]">
									Teams
								</div>
								{["Entwicklung", "Marketing", "Vertrieb"].map((item, i) => (
									<div key={i} className="px-3 py-1.5 text-[12px] text-[#bbb]">
										{item}
									</div>
								))}
							</div>
							{/* Main */}
							<div className="flex-1 p-6" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>
								<div className="mb-4 flex items-center justify-between">
									<h3 className="text-[16px] font-semibold">Zeiterfassung &mdash; Februar 2025</h3>
									<div className="flex gap-2">
										{["Filter", "Sortieren", "Exportieren"].map((a, i) => (
											<span key={i} className="rounded-md bg-[#f5f5f5] px-3 py-1.5 text-[11px] text-[#888]">{a}</span>
										))}
									</div>
								</div>
								{/* Table */}
								<div className="overflow-hidden rounded-xl border border-[#f0f0f0]">
									<div className="grid grid-cols-4 bg-[#fafafa] px-4 py-2.5 text-[11px] font-semibold text-[#999]">
										<span>Mitarbeiter</span>
										<span>Status</span>
										<span>Heute</span>
										<span>Monat</span>
									</div>
									{[
										{ name: "Max Müller", status: "Aktiv", today: "7h 42m", month: "156h" },
										{ name: "Anna Schmidt", status: "Pause", today: "5h 18m", month: "148h" },
										{ name: "Lukas Weber", status: "Aktiv", today: "8h 01m", month: "162h" },
										{ name: "Sarah Fischer", status: "Abwesend", today: "—", month: "120h" },
										{ name: "Tom Braun", status: "Aktiv", today: "6h 55m", month: "155h" },
									].map((row, i) => (
										<div key={i} className="grid grid-cols-4 items-center border-t border-[#f0f0f0] px-4 py-3 text-[12px]">
											<div className="flex items-center gap-2">
												<div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f0f0f0] text-[8px] font-bold text-[#999]">
													{row.name.split(" ").map(n => n[0]).join("")}
												</div>
												<span className="font-medium">{row.name}</span>
											</div>
											<span
												className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
												style={{
													backgroundColor: row.status === "Aktiv" ? "#dcfce7" : row.status === "Pause" ? "#fef3c7" : "#f3f4f6",
													color: row.status === "Aktiv" ? "#16a34a" : row.status === "Pause" ? "#d97706" : "#9ca3af",
												}}
											>
												{row.status}
											</span>
											<span className="text-[#666]">{row.today}</span>
											<span className="text-[#666]">{row.month}</span>
										</div>
									))}
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Gradient fade to features */}
			<div className="h-24" style={{ background: "linear-gradient(180deg, #fefefe, #f8f8f8)" }} />

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-20 lg:px-16" style={{ backgroundColor: "#f8f8f8" }}>
				<div className="mx-auto max-w-5xl">
					<div className="mb-14 text-center">
						<h2 className="text-[clamp(2rem,4vw,3rem)] tracking-[-0.02em]" style={{ fontWeight: 600 }}>
							Alles, was z&auml;hlt.
						</h2>
					</div>
					<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation über alle Geräte." },
							{ title: "GoBD-konform", desc: "Revisionssicher. Lückenlos. Unantastbar dokumentiert." },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch und nahtlos." },
							{ title: "Multi-Tenant", desc: "Mandantenfähig. Isoliert, sicher, skalierbar." },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlos integriert." },
							{ title: "Dashboards", desc: "Überstunden, Trends, Auswertungen. Live und sofort." },
						].map((f, i) => (
							<div
								key={i}
								className="group rounded-2xl bg-white p-7 transition-shadow hover:shadow-md"
								style={{ border: "1px solid #eee" }}
							>
								<h3 className="mb-2 text-[16px] font-semibold" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>{f.title}</h3>
								<p className="text-[13px] leading-[1.7] text-[#888]" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>{f.desc}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Quote */}
			<section className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-2xl text-center">
					<blockquote className="text-[clamp(1.5rem,3.5vw,2.5rem)] leading-[1.4] tracking-[-0.02em]" style={{ fontWeight: 500 }}>
						Pr&auml;zision ist keine Funktion &mdash;
						sie ist das Fundament.
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 pb-24 lg:px-16">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="mb-4 text-3xl tracking-[-0.02em]" style={{ fontWeight: 600 }}>
						Bereit f&uuml;r den n&auml;chsten Schritt?
					</h2>
					<p className="mb-8 text-[15px] text-[#888]" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>
						Erleben Sie Z8 in Aktion &mdash; kostenlos und unverbindlich.
					</p>
					<div className="flex items-center justify-center gap-3" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>
						<a
							href="mailto:hello@z8.app"
							className="rounded-lg px-8 py-3.5 text-[15px] font-semibold text-white transition-all hover:opacity-90"
							style={{ backgroundColor: "#111" }}
						>
							Kostenlos starten
						</a>
						<a href="mailto:hello@z8.app" className="rounded-lg px-8 py-3.5 text-[15px] text-[#666] transition-colors hover:text-[#111]" style={{ border: "1px solid #ddd" }}>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #f0f0f0" }}>
				<div className="flex items-center justify-between text-[13px] text-[#ccc]" style={{ fontFamily: "'Outfit', 'Manrope', sans-serif" }}>
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#111]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
