import Image from "next/image";
import Link from "next/link";

export default function Design2() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Georgia', 'Times New Roman', serif",
				backgroundColor: "#faf7f2",
				color: "#2a2520",
			}}
		>
			{/* Header */}
			<header className="flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-baseline gap-2">
					<span
						className="text-3xl font-bold italic tracking-tight"
						style={{ fontFamily: "'Georgia', serif" }}
					>
						Z8
					</span>
					<span
						className="text-[10px] font-medium uppercase tracking-[0.3em]"
						style={{
							fontFamily: "'Trebuchet MS', sans-serif",
							color: "#9e9589",
						}}
					>
						Zeitwirtschaft
					</span>
				</div>
				<nav
					className="hidden items-center gap-10 text-[13px] md:flex"
					style={{ color: "#7a7570" }}
				>
					<a href="#features" className="transition-colors hover:text-[#2a2520]">
						Funktionen
					</a>
					<a href="#philosophy" className="transition-colors hover:text-[#2a2520]">
						Philosophie
					</a>
					<a href="#contact" className="transition-colors hover:text-[#2a2520]">
						Kontakt
					</a>
				</nav>
				<a
					href="#contact"
					className="rounded-full px-6 py-2.5 text-[12px] font-medium transition-colors"
					style={{
						fontFamily: "'Trebuchet MS', sans-serif",
						backgroundColor: "#2a2520",
						color: "#faf7f2",
					}}
				>
					Gespr&auml;ch vereinbaren
				</a>
			</header>

			{/* Divider line */}
			<div className="mx-8 h-px lg:mx-16" style={{ backgroundColor: "#e5dfd7" }} />

			{/* Hero */}
			<section className="px-8 pb-24 pt-20 lg:px-16">
				<div className="grid items-start gap-16 lg:grid-cols-12">
					{/* Left column - large serif headline */}
					<div className="lg:col-span-7">
						<p
							className="animate-fade-up mb-8 text-[11px] font-semibold uppercase tracking-[0.4em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#b5a99a",
								animationDelay: "0.1s",
							}}
						>
							Arbeitszeitverwaltung
						</p>
						<h1
							className="animate-fade-up text-[clamp(2.8rem,7vw,5.5rem)] leading-[1.05] tracking-[-0.02em]"
							style={{ animationDelay: "0.2s" }}
						>
							Arbeitszeit verdient{" "}
							<em className="not-italic" style={{ color: "#a08060" }}>
								Sorgfalt
							</em>
							, nicht nur Software.
						</h1>
					</div>

					{/* Right column - excerpt */}
					<div
						className="animate-fade-up flex flex-col justify-end lg:col-span-4 lg:col-start-9 lg:pt-32"
						style={{ animationDelay: "0.4s" }}
					>
						<div className="mb-6 h-px w-16" style={{ backgroundColor: "#c4b9aa" }} />
						<p className="text-[15px] leading-[1.8]" style={{ color: "#7a7570" }}>
							Z8 vereint GoBD-konforme Zeiterfassung mit einer Benutzeroberfl&auml;che, die man
							gerne &ouml;ffnet. F&uuml;r Teams, die Wert auf Substanz legen.
						</p>
					</div>
				</div>

				{/* Editorial image - workspace */}
				<div
					className="animate-scale-in relative mt-16 overflow-hidden rounded-sm"
					style={{ animationDelay: "0.5s" }}
				>
					<div className="relative h-[45vh]">
						<Image
							src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80&auto=format&fit=crop"
							alt="Modern workspace"
							fill
							className="object-cover"
							style={{ objectPosition: "center 60%" }}
						/>
						<div
							className="absolute inset-0"
							style={{
								background:
									"linear-gradient(180deg, rgba(250,247,242,0) 60%, rgba(250,247,242,0.4) 100%)",
							}}
						/>
					</div>
					<div className="absolute bottom-6 left-8">
						<span
							className="text-[11px] uppercase tracking-[0.4em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#2a2520",
								backgroundColor: "rgba(250,247,242,0.85)",
								padding: "6px 14px",
							}}
						>
							Z8 Arbeitsumgebung
						</span>
					</div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="px-8 pb-32 lg:px-16">
				<div className="mb-16 grid gap-8 lg:grid-cols-12">
					<div className="lg:col-span-4">
						<p
							className="mb-3 text-[11px] font-semibold uppercase tracking-[0.4em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#b5a99a",
							}}
						>
							Was Z8 ausmacht
						</p>
						<h2 className="text-3xl leading-snug tracking-tight">Durchdacht bis ins Detail</h2>
					</div>
				</div>

				<div className="grid gap-12 md:grid-cols-2 lg:grid-cols-3">
					{[
						{
							title: "Stempeluhr",
							desc: "Web, Desktop, Mobile, Browser \u2014 ein Klick gen\u00fcgt. Immer synchron, immer verf\u00fcgbar.",
						},
						{
							title: "Revisionssicherheit",
							desc: "Jeder Zeiteintrag unver\u00e4nderbar protokolliert. GoBD-konforme Archivierung inklusive.",
						},
						{
							title: "Lohn-Schnittstellen",
							desc: "DATEV, Lexware, Personio und weitere. Nahtloser Export ohne manuelle Nacharbeit.",
						},
						{
							title: "Team-\u00dcbersicht",
							desc: "Anwesenheit, \u00dcberstunden, Urlaubssalden \u2014 alles auf einen Blick, f\u00fcr jeden zug\u00e4nglich.",
						},
						{
							title: "Enterprise-SSO",
							desc: "SAML, OIDC, SCIM. Nahtlose Integration in Ihre bestehende Identity-Infrastruktur.",
						},
						{
							title: "Kalender-Sync",
							desc: "Google Calendar, Microsoft 365. Termine und Arbeitszeiten automatisch abgeglichen.",
						},
					].map((f, i) => (
						<div key={i} className="group">
							<div
								className="mb-5 h-px transition-all group-hover:w-16"
								style={{ backgroundColor: "#c4b9aa", width: "32px" }}
							/>
							<h3 className="mb-3 text-xl tracking-tight">{f.title}</h3>
							<p className="text-[14px] leading-[1.8]" style={{ color: "#7a7570" }}>
								{f.desc}
							</p>
						</div>
					))}
				</div>
			</section>

			{/* Editorial image pair */}
			<section className="px-8 pb-24 lg:px-16">
				<div className="grid gap-4 md:grid-cols-2">
					<div className="relative h-[35vh] overflow-hidden rounded-sm">
						<Image
							src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80&auto=format&fit=crop"
							alt="Team collaboration"
							fill
							className="object-cover transition-transform duration-700 hover:scale-105"
						/>
						<div
							className="absolute inset-0"
							style={{
								background:
									"linear-gradient(180deg, transparent 50%, rgba(42,37,32,0.3) 100%)",
							}}
						/>
						<div className="absolute bottom-5 left-6">
							<span
								className="text-[10px] font-semibold uppercase tracking-[0.4em]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									color: "#faf7f2",
								}}
							>
								Team-Zusammenarbeit
							</span>
						</div>
					</div>
					<div className="relative h-[35vh] overflow-hidden rounded-sm">
						<Image
							src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&q=80&auto=format&fit=crop"
							alt="Focused work"
							fill
							className="object-cover transition-transform duration-700 hover:scale-105"
						/>
						<div
							className="absolute inset-0"
							style={{
								background:
									"linear-gradient(180deg, transparent 50%, rgba(42,37,32,0.3) 100%)",
							}}
						/>
						<div className="absolute bottom-5 left-6">
							<span
								className="text-[10px] font-semibold uppercase tracking-[0.4em]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									color: "#faf7f2",
								}}
							>
								Fokussiertes Arbeiten
							</span>
						</div>
					</div>
				</div>
			</section>

			{/* Philosophy quote */}
			<section
				id="philosophy"
				className="relative overflow-hidden px-8 py-24 lg:px-16"
				style={{ backgroundColor: "#2a2520", color: "#faf7f2" }}
			>
				{/* Background image with heavy overlay */}
				<div className="absolute inset-0">
					<Image
						src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=1600&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover opacity-10"
					/>
				</div>
				<div className="relative z-10 mx-auto max-w-3xl text-center">
					<span className="mb-8 block text-7xl" style={{ color: "#a08060", lineHeight: 1 }}>
						&ldquo;
					</span>
					<blockquote className="text-[clamp(1.5rem,3.5vw,2.5rem)] leading-[1.4] tracking-tight">
						Gute Zeiterfassung ist unsichtbar. Sie funktioniert einfach &mdash; und l&auml;sst Sie
						sich auf das konzentrieren, was z&auml;hlt.
					</blockquote>
					<div className="mx-auto mt-10 h-px w-16" style={{ backgroundColor: "#5a5550" }} />
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="px-8 py-32 lg:px-16">
				<div className="grid items-start gap-16 lg:grid-cols-12">
					<div className="lg:col-span-5">
						<p
							className="mb-3 text-[11px] font-semibold uppercase tracking-[0.4em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#b5a99a",
							}}
						>
							Kontakt
						</p>
						<h2 className="text-4xl leading-snug tracking-tight">
							Bereit f&uuml;r eine Zeiterfassung, die &uuml;berzeugt?
						</h2>
					</div>
					<div className="flex flex-col gap-6 lg:col-span-5 lg:col-start-8 lg:pt-12">
						<p className="text-[15px] leading-[1.8]" style={{ color: "#7a7570" }}>
							Wir freuen uns, Ihnen Z8 pers&ouml;nlich vorzustellen. Vereinbaren Sie eine Demo und
							erleben Sie den Unterschied.
						</p>
						<div className="flex gap-4">
							<a
								href="mailto:hello@z8.app"
								className="rounded-full px-7 py-3 text-[13px] font-medium transition-colors"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									backgroundColor: "#2a2520",
									color: "#faf7f2",
								}}
							>
								Demo anfragen
							</a>
							<a
								href="mailto:hello@z8.app"
								className="rounded-full px-7 py-3 text-[13px] font-medium transition-colors"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									border: "1px solid #c4b9aa",
									color: "#7a7570",
								}}
							>
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #e5dfd7" }}>
				<div className="flex items-center justify-between">
					<span
						className="text-[11px] tracking-wide"
						style={{
							fontFamily: "'Trebuchet MS', sans-serif",
							color: "#b5a99a",
						}}
					>
						&copy; 2025 Z8
					</span>
					<Link
						href="/"
						className="text-[11px] tracking-wide transition-colors hover:text-[#2a2520]"
						style={{
							fontFamily: "'Trebuchet MS', sans-serif",
							color: "#b5a99a",
						}}
					>
						&larr; Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
