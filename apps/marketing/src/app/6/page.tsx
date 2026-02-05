import Image from "next/image";
import Link from "next/link";

export default function Design6() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
				backgroundColor: "#0f1419",
				color: "#e8e4df",
			}}
		>
			{/* Subtle noise texture */}
			<div
				className="pointer-events-none fixed inset-0 z-0 opacity-[0.03]"
				style={{
					backgroundImage:
						"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
					backgroundRepeat: "repeat",
					backgroundSize: "256px 256px",
				}}
			/>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-baseline gap-3">
					<span
						className="text-2xl font-bold tracking-[-0.03em]"
						style={{ color: "#c9a96e" }}
					>
						Z8
					</span>
					<div className="h-4 w-px" style={{ backgroundColor: "#c9a96e30" }} />
					<span
						className="text-[10px] font-normal uppercase tracking-[0.4em]"
						style={{
							fontFamily: "'Trebuchet MS', 'Lucida Sans', sans-serif",
							color: "#5a5550",
						}}
					>
						Zeitwirtschaft
					</span>
				</div>
				<nav
					className="hidden items-center gap-10 text-[13px] tracking-wide md:flex"
					style={{ color: "#6a6560" }}
				>
					<a href="#features" className="transition-colors hover:text-[#c9a96e]">
						Funktionen
					</a>
					<a href="#editorial" className="transition-colors hover:text-[#c9a96e]">
						Vision
					</a>
					<a href="#contact" className="transition-colors hover:text-[#c9a96e]">
						Kontakt
					</a>
				</nav>
				<a
					href="#contact"
					className="px-6 py-2.5 text-[11px] font-bold uppercase tracking-[0.25em] transition-all"
					style={{
						fontFamily: "'Trebuchet MS', sans-serif",
						border: "1px solid #c9a96e40",
						color: "#c9a96e",
					}}
				>
					Demo anfragen
				</a>
			</header>

			<div className="mx-8 h-px lg:mx-16" style={{ backgroundColor: "#c9a96e15" }} />

			{/* Hero - editorial magazine spread */}
			<section className="relative z-10 px-8 pb-12 pt-20 lg:px-16">
				<div className="grid gap-12 lg:grid-cols-12">
					{/* Left - large serif headline */}
					<div className="lg:col-span-7">
						<p
							className="animate-fade-up mb-10 text-[10px] font-semibold uppercase tracking-[0.5em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#c9a96e",
								animationDelay: "0.1s",
							}}
						>
							Ausgabe 01 &mdash; Zeiterfassung
						</p>
						<h1
							className="animate-fade-up text-[clamp(3rem,7.5vw,6rem)] leading-[1.02] tracking-[-0.02em]"
							style={{ animationDelay: "0.2s" }}
						>
							Die Kunst der
							<br />
							<em style={{ color: "#c9a96e" }}>pr&auml;zisen</em>
							<br />
							Zeiterfassung
						</h1>
					</div>

					{/* Right - editorial sidebar */}
					<div
						className="animate-fade-up flex flex-col justify-end lg:col-span-4 lg:col-start-9"
						style={{ animationDelay: "0.4s" }}
					>
						<div className="mb-6 h-px w-20" style={{ backgroundColor: "#c9a96e40" }} />
						<p className="text-[15px] italic leading-[1.9]" style={{ color: "#7a7570" }}>
							Eine Plattform, die versteht, dass Arbeitszeiterfassung mehr ist als
							Pflicht &mdash; sie ist ein Ausdruck von Wertsch&auml;tzung f&uuml;r die
							wertvollste Ressource Ihres Unternehmens.
						</p>
					</div>
				</div>
			</section>

			{/* Hero image - full bleed editorial */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="animate-scale-in relative overflow-hidden" style={{ animationDelay: "0.5s" }}>
					<div className="relative h-[55vh]">
						<Image
							src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1800&q=80&auto=format&fit=crop"
							alt="Modern workspace"
							fill
							className="object-cover"
							style={{ objectPosition: "center 40%" }}
							priority
						/>
						<div
							className="absolute inset-0"
							style={{
								background:
									"linear-gradient(180deg, rgba(15,20,25,0.1) 0%, rgba(15,20,25,0.6) 100%)",
							}}
						/>
					</div>
					{/* Overlapping caption */}
					<div
						className="absolute bottom-0 left-0 px-8 py-6"
						style={{ backgroundColor: "#0f1419ee" }}
					>
						<span
							className="text-[10px] uppercase tracking-[0.4em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#c9a96e",
							}}
						>
							Z8 &mdash; Arbeitsumgebung
						</span>
					</div>
					{/* Gold corner accent */}
					<div
						className="absolute right-0 top-0 h-24 w-24"
						style={{
							borderRight: "2px solid #c9a96e40",
							borderTop: "2px solid #c9a96e40",
						}}
					/>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 pb-32 lg:px-16">
				<div className="mb-20 grid gap-12 lg:grid-cols-12">
					<div className="lg:col-span-5">
						<span
							className="mb-4 block text-[10px] font-semibold uppercase tracking-[0.5em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#c9a96e",
							}}
						>
							Kapitel I
						</span>
						<h2 className="text-4xl leading-[1.15] tracking-tight">
							Sechs Gr&uuml;nde, die &uuml;berzeugen
						</h2>
					</div>
					<div className="flex items-end lg:col-span-4 lg:col-start-9">
						<p className="text-[14px] italic leading-[1.9]" style={{ color: "#6a6560" }}>
							Jede Funktion wurde mit der gleichen Sorgfalt entwickelt, die wir auch von Ihnen
							f&uuml;r Ihre Arbeit erwarten.
						</p>
					</div>
				</div>

				<div className="grid gap-x-8 gap-y-16 md:grid-cols-2 lg:grid-cols-3">
					{[
						{
							num: "01",
							title: "Stempeluhr",
							desc: "Web, Desktop, Mobile, Browser-Extension. Ein Klick, sofort synchron &uuml;ber alle Ger&auml;te.",
						},
						{
							num: "02",
							title: "GoBD-Konformit\u00e4t",
							desc: "Revisionssichere, unver\u00e4nderbare Zeiteintr\u00e4ge. L\u00fcckenlose Nachvollziehbarkeit f\u00fcr jede Pr\u00fcfung.",
						},
						{
							num: "03",
							title: "Lohnexport",
							desc: "DATEV, Lexware, Personio, SAP. Nahtlose Integration ohne Medienbruch.",
						},
						{
							num: "04",
							title: "Multi-Tenant",
							desc: "Mandantenf\u00e4hige Architektur. Jede Organisation isoliert, sicher und performant.",
						},
						{
							num: "05",
							title: "SSO & SCIM",
							desc: "SAML, OpenID Connect, automatisierte Benutzerverwaltung. Enterprise-ready.",
						},
						{
							num: "06",
							title: "Echtzeit-Dashboards",
							desc: "\u00dcberstunden, Fehlzeiten, Teamauslastung \u2014 visualisiert in Echtzeit.",
						},
					].map((f) => (
						<div key={f.num} className="group">
							<span
								className="mb-4 block text-[11px] font-bold tracking-[0.3em]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									color: "#c9a96e50",
								}}
							>
								{f.num}
							</span>
							<h3 className="mb-3 text-xl tracking-tight">{f.title}</h3>
							<p className="text-[14px] leading-[1.85]" style={{ color: "#6a6560" }}>
								{f.desc}
							</p>
							<div
								className="mt-5 h-px w-8 transition-all duration-500 group-hover:w-16"
								style={{ backgroundColor: "#c9a96e30" }}
							/>
						</div>
					))}
				</div>
			</section>

			{/* Editorial image pair */}
			<section className="relative z-10 mx-8 mb-32 lg:mx-16">
				<div className="grid gap-4 md:grid-cols-5">
					<div className="relative h-[40vh] overflow-hidden md:col-span-3">
						<Image
							src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1000&q=80&auto=format&fit=crop"
							alt="Team at work"
							fill
							className="object-cover transition-transform duration-700 hover:scale-[1.02]"
						/>
						<div
							className="absolute inset-0"
							style={{
								background:
									"linear-gradient(180deg, transparent 50%, rgba(15,20,25,0.5) 100%)",
							}}
						/>
						<div className="absolute bottom-6 left-6">
							<span
								className="text-[10px] uppercase tracking-[0.4em]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									color: "#c9a96e",
								}}
							>
								Zusammenarbeit
							</span>
						</div>
					</div>
					<div className="relative h-[40vh] overflow-hidden md:col-span-2">
						<Image
							src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=800&q=80&auto=format&fit=crop"
							alt="Workspace detail"
							fill
							className="object-cover transition-transform duration-700 hover:scale-[1.02]"
						/>
						<div
							className="absolute inset-0"
							style={{
								background:
									"linear-gradient(180deg, transparent 50%, rgba(15,20,25,0.5) 100%)",
							}}
						/>
						<div className="absolute bottom-6 left-6">
							<span
								className="text-[10px] uppercase tracking-[0.4em]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									color: "#c9a96e",
								}}
							>
								Fokus
							</span>
						</div>
					</div>
				</div>
			</section>

			{/* Editorial quote */}
			<section id="editorial" className="relative z-10 overflow-hidden px-8 py-28 lg:px-16">
				<div className="absolute inset-0">
					<Image
						src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover opacity-[0.06]"
					/>
				</div>
				<div className="relative z-10 mx-auto max-w-3xl text-center">
					<span
						className="mb-6 block text-6xl leading-none"
						style={{ color: "#c9a96e" }}
					>
						&ldquo;
					</span>
					<blockquote className="text-[clamp(1.6rem,3.5vw,2.8rem)] leading-[1.35] tracking-[-0.01em]">
						Zeiterfassung sollte sich nicht wie eine Pflicht anf&uuml;hlen &mdash; sondern wie
						ein nat&uuml;rlicher Teil guter Arbeit.
					</blockquote>
					<div
						className="mx-auto mt-10 h-px w-20"
						style={{ backgroundColor: "#c9a96e30" }}
					/>
					<p
						className="mt-6 text-[11px] uppercase tracking-[0.4em]"
						style={{
							fontFamily: "'Trebuchet MS', sans-serif",
							color: "#c9a96e60",
						}}
					>
						Die Z8-Philosophie
					</p>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-32 lg:px-16">
				<div className="mx-8 mb-16 h-px lg:mx-0" style={{ backgroundColor: "#c9a96e15" }} />
				<div className="grid items-start gap-16 lg:grid-cols-12">
					<div className="lg:col-span-5">
						<span
							className="mb-4 block text-[10px] font-semibold uppercase tracking-[0.5em]"
							style={{
								fontFamily: "'Trebuchet MS', sans-serif",
								color: "#c9a96e",
							}}
						>
							Kapitel II
						</span>
						<h2 className="text-4xl leading-[1.15] tracking-tight">
							Beginnen wir ein Gespr&auml;ch.
						</h2>
					</div>
					<div className="flex flex-col gap-6 lg:col-span-5 lg:col-start-8 lg:pt-8">
						<p className="text-[15px] italic leading-[1.9]" style={{ color: "#6a6560" }}>
							Wir stellen Ihnen Z8 pers&ouml;nlich vor &mdash; in Ihrem Tempo, mit Ihren Fragen.
						</p>
						<div className="flex gap-4">
							<a
								href="mailto:hello@z8.app"
								className="px-7 py-3.5 text-[11px] font-bold uppercase tracking-[0.25em] transition-all hover:bg-[#c9a96e] hover:text-[#0f1419]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									border: "1px solid #c9a96e",
									color: "#c9a96e",
								}}
							>
								Demo vereinbaren
							</a>
							<a
								href="mailto:hello@z8.app"
								className="px-7 py-3.5 text-[11px] tracking-[0.2em] transition-colors hover:text-[#c9a96e]"
								style={{
									fontFamily: "'Trebuchet MS', sans-serif",
									color: "#5a5550",
								}}
							>
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #c9a96e15" }}>
				<div className="flex items-center justify-between">
					<span
						className="text-[10px] tracking-[0.3em]"
						style={{
							fontFamily: "'Trebuchet MS', sans-serif",
							color: "#3a3530",
						}}
					>
						&copy; 2025 Z8
					</span>
					<Link
						href="/"
						className="text-[10px] tracking-[0.3em] transition-colors hover:text-[#c9a96e]"
						style={{
							fontFamily: "'Trebuchet MS', sans-serif",
							color: "#3a3530",
						}}
					>
						&larr; Alle Designs
					</Link>
				</div>
			</footer>
		</div>
	);
}
