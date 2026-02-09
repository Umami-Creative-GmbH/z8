import Image from "next/image";
import Link from "next/link";

export default function DesignS8() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Newsreader', 'Source Serif 4', 'Crimson Pro', 'Times New Roman', serif",
				backgroundColor: "#f8f4ec",
				color: "#1a1a18",
			}}
		>
			{/* Newspaper masthead */}
			<header className="relative z-20 px-8 pt-6 lg:px-16">
				{/* Top dateline */}
				<div
					className="flex items-center justify-between pb-3 text-[10px] tracking-[0.1em] uppercase"
					style={{ color: "#8a8470", borderBottom: "1px solid #d0c8b8" }}
				>
					<span>Ausgabe Nr. 1 — 2025</span>
					<span>Frankfurt am Main</span>
					<span>Donnerstag, 6. Februar</span>
				</div>

				{/* Masthead */}
				<div
					className="flex flex-col items-center py-6"
					style={{ borderBottom: "4px double #1a1a18" }}
				>
					<h1
						className="text-[clamp(3rem,8vw,6rem)] font-black leading-none tracking-[-0.04em]"
						style={{ fontVariant: "small-caps" }}
					>
						Z8 Anzeiger
					</h1>
					<p className="mt-1 text-[12px] tracking-[0.4em] uppercase" style={{ color: "#6a6458" }}>
						Die Zeitung für moderne Zeiterfassung
					</p>
				</div>

				{/* Nav bar */}
				<nav
					className="flex items-center justify-center gap-8 py-3 text-[11px] font-bold tracking-[0.15em] uppercase"
					style={{ color: "#4a4438", borderBottom: "1px solid #d0c8b8" }}
				>
					<a href="#lead" className="transition-colors hover:text-[#b82020]">Titelstory</a>
					<span style={{ color: "#d0c8b8" }}>|</span>
					<a href="#features" className="transition-colors hover:text-[#b82020]">Rubriken</a>
					<span style={{ color: "#d0c8b8" }}>|</span>
					<a href="#contact" className="transition-colors hover:text-[#b82020]">Abonnement</a>
				</nav>
			</header>

			{/* Lead story — hero */}
			<section id="lead" className="relative z-10 px-8 py-16 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<div className="grid gap-12 lg:grid-cols-[2fr_1fr]">
						{/* Main column */}
						<div>
							<p
								className="animate-fade-up text-[11px] font-bold tracking-[0.2em] uppercase"
								style={{ color: "#b82020", animationDelay: "0.1s" }}
							>
								Exklusiv
							</p>
							<h2
								className="animate-fade-up mt-3 text-[clamp(2rem,4vw,3.5rem)] leading-[1.1] tracking-[-0.02em]"
								style={{ animationDelay: "0.2s" }}
							>
								Zeiterfassung revolutioniert:
								<br />
								Z8 macht Schluss mit Zettelwirtschaft
							</h2>
							<div
								className="animate-fade-up my-6 h-px"
								style={{ backgroundColor: "#d0c8b8", animationDelay: "0.3s" }}
							/>
							<div
								className="animate-fade-up columns-2 gap-8 text-[14.5px] leading-[1.75]"
								style={{ color: "#3a3a30", animationDelay: "0.35s" }}
							>
								<p className="mb-4">
									<span className="text-[36px] font-bold leading-none float-left mr-2 mt-1" style={{ color: "#b82020" }}>
										D
									</span>
									as Frankfurter Startup Z8 präsentiert eine neue Generation der
									Arbeitszeiterfassung. Schluss mit Excel-Tabellen, handgeschriebenen
									Stundenzetteln und verlorenen Daten.
								</p>
								<p className="mb-4">
									Mit nur einem Klick erfassen Mitarbeiter ihre Arbeitszeit — präzise,
									digital und in Echtzeit. Das Dashboard zeigt sofort alle relevanten
									Kennzahlen auf einen Blick.
								</p>
								<p>
									Besonders für kleine und mittlere Unternehmen ist Z8 eine Offenbarung:
									Einfach einrichten, Team einladen und sofort loslegen.
									Keine Schulung nötig.
								</p>
							</div>
						</div>

						{/* Sidebar */}
						<div
							className="animate-fade-in flex flex-col gap-6 lg:border-l lg:pl-8"
							style={{ borderColor: "#d0c8b8", animationDelay: "0.5s" }}
						>
							<div>
								<h3 className="text-[13px] font-bold tracking-[0.1em] uppercase" style={{ color: "#b82020" }}>
									Kurzmeldungen
								</h3>
								<div className="mt-4 space-y-4">
									{[
										"10.000 Nutzer vertrauen bereits auf Z8",
										"DSGVO-konforme Datenhaltung auf deutschen Servern",
										"Neue API-Schnittstellen für SAP und DATEV",
									].map((item, i) => (
										<div
											key={i}
											className="pb-4"
											style={{ borderBottom: "1px solid #e0d8c8" }}
										>
											<p className="text-[13px] leading-[1.5]" style={{ color: "#3a3a30" }}>
												{item}
											</p>
										</div>
									))}
								</div>
							</div>

							{/* Ad box */}
							<div
								className="p-6 text-center"
								style={{
									border: "2px solid #1a1a18",
									backgroundColor: "#f2eee4",
								}}
							>
								<p className="text-[10px] tracking-[0.2em] uppercase" style={{ color: "#8a8470" }}>
									Anzeige
								</p>
								<p className="mt-3 text-[20px] font-bold" style={{ color: "#1a1a18" }}>
									Z8 Pro
								</p>
								<p className="mt-1 text-[12px]" style={{ color: "#6a6458" }}>
									Jetzt 30 Tage kostenlos
								</p>
								<a
									href="#contact"
									className="mt-4 inline-block px-6 py-2 text-[11px] font-bold tracking-[0.1em] uppercase transition-colors hover:bg-[#1a1a18] hover:text-[#f8f4ec]"
									style={{ border: "1px solid #1a1a18" }}
								>
									Testen
								</a>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Photo section — newspaper style */}
			<section className="relative z-10 mx-8 mb-8 lg:mx-16">
				<div className="mx-auto max-w-5xl grid gap-6 md:grid-cols-[2fr_1fr]">
					<div className="relative h-72 overflow-hidden">
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=900&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.2) contrast(1.1)" }} />
						<div className="absolute bottom-0 left-0 right-0 px-4 py-3" style={{ backgroundColor: "rgba(248,244,236,0.9)" }}>
							<p className="text-[11px] italic" style={{ color: "#6a6458" }}>Team-Meeting bei einem Z8-Kunden in Frankfurt. Foto: Archiv</p>
						</div>
					</div>
					<div className="relative h-72 overflow-hidden">
						<Image src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=600&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.2) contrast(1.1)" }} />
						<div className="absolute bottom-0 left-0 right-0 px-4 py-3" style={{ backgroundColor: "rgba(248,244,236,0.9)" }}>
							<p className="text-[11px] italic" style={{ color: "#6a6458" }}>Modernes Büro mit Z8-Integration</p>
						</div>
					</div>
				</div>
			</section>

			{/* Feature columns — broadsheet style */}
			<section
				id="features"
				className="relative z-10 px-8 py-16 lg:px-16"
				style={{ borderTop: "2px solid #1a1a18" }}
			>
				<div className="mx-auto max-w-5xl">
					<h3
						className="mb-8 text-center text-[13px] font-bold tracking-[0.3em] uppercase"
						style={{ color: "#6a6458" }}
					>
						Rubriken
					</h3>
					<div
						className="grid gap-8 md:grid-cols-3"
						style={{ borderTop: "1px solid #d0c8b8", paddingTop: "2rem" }}
					>
						{[
							{
								title: "Stempeluhr",
								desc: "Die digitale Stechuhr für das 21. Jahrhundert. Start, Pause, Ende — alles mit einem Fingertipp. Funktioniert auf Smartphone, Tablet und Desktop gleichermassen.",
							},
							{
								title: "Berichte & Export",
								desc: "Monatsberichte generieren sich automatisch. Export in CSV, PDF oder direkt an Ihren Steuerberater. Keine manuelle Nacharbeit mehr nötig.",
							},
							{
								title: "Team-Verwaltung",
								desc: "Mitarbeiter per E-Mail einladen, Rollen zuweisen, Arbeitszeiten überblicken. Alles an einem Ort. Für Teams von 2 bis 2.000.",
							},
						].map((f) => (
							<div key={f.title}>
								<h4 className="text-[18px] font-bold tracking-[-0.01em]">{f.title}</h4>
								<p className="mt-3 text-[13.5px] leading-[1.7]" style={{ color: "#4a4438" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* CTA — classified ad style */}
			<section
				id="contact"
				className="relative z-10 px-8 py-16 lg:px-16"
				style={{ borderTop: "4px double #1a1a18" }}
			>
				<div className="mx-auto flex max-w-2xl flex-col items-center text-center">
					<p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: "#8a8470" }}>
						Kleinanzeige
					</p>
					<h2 className="mt-4 text-[clamp(1.8rem,3.5vw,2.8rem)] font-bold tracking-[-0.02em]">
						Z8 — Jetzt abonnieren.
					</h2>
					<p className="mt-3 text-[14px] leading-[1.6]" style={{ color: "#5a5a50" }}>
						Kostenlos starten. Keine Kreditkarte erforderlich.
						Jederzeit kündbar.
					</p>
					<a
						href="#"
						className="mt-8 px-10 py-3.5 text-[11px] font-bold tracking-[0.15em] uppercase transition-colors hover:bg-[#1a1a18] hover:text-[#f8f4ec]"
						style={{ border: "2px solid #1a1a18" }}
					>
						Jetzt kostenlos starten
					</a>
				</div>
			</section>

			{/* Footer — colophon */}
			<footer className="px-8 py-6 lg:px-16" style={{ borderTop: "1px solid #d0c8b8" }}>
				<div className="flex items-center justify-between">
					<span className="text-[10px] tracking-[0.1em] uppercase" style={{ color: "#8a8470" }}>
						© 2025 Z8 Anzeiger — Alle Rechte vorbehalten
					</span>
					<Link href="/" className="text-[10px] tracking-[0.1em] uppercase transition-colors hover:text-[#b82020]" style={{ color: "#8a8470" }}>
						← Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
