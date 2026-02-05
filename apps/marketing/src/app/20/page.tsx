import Image from "next/image";
import Link from "next/link";

export default function Design20() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Charter', 'Bitstream Charter', 'Cambria', serif",
				backgroundColor: "#0c1a0f",
				color: "#c8d8ca",
			}}
		>
			{/* Subtle leaf pattern */}
			<div
				className="pointer-events-none fixed inset-0 z-0 opacity-[0.02]"
				style={{
					backgroundImage: "radial-gradient(circle at 50% 50%, #2d5a3510 0%, transparent 50%)",
					backgroundSize: "120px 120px",
				}}
			/>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-baseline gap-3">
					<span className="text-2xl font-bold" style={{ color: "#4a9960" }}>Z8</span>
					<span className="text-[10px] uppercase tracking-[0.4em] text-[#2d5a35]">Zeiterfassung</span>
				</div>
				<nav className="hidden items-center gap-10 text-[12px] tracking-wide text-[#3a6b42] md:flex">
					<a href="#features" className="transition-colors hover:text-[#4a9960]">Funktionen</a>
					<a href="#roots" className="transition-colors hover:text-[#4a9960]">Wurzeln</a>
					<a href="#contact" className="transition-colors hover:text-[#4a9960]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] transition-all hover:bg-[#4a9960] hover:text-[#0c1a0f]"
					style={{ border: "1px solid #4a9960", color: "#4a9960" }}
				>
					Anfragen
				</a>
			</header>

			<div className="mx-8 h-px lg:mx-16" style={{ backgroundColor: "#4a996015" }} />

			{/* Hero */}
			<section className="relative z-10 px-8 pb-16 pt-24 lg:px-16">
				<div className="grid gap-12 lg:grid-cols-2">
					<div>
						<p
							className="animate-fade-up mb-8 text-[10px] uppercase tracking-[0.5em]"
							style={{ color: "#4a9960", animationDelay: "0.1s" }}
						>
							Organisch gewachsen
						</p>
						<h1
							className="animate-fade-up text-[clamp(3rem,7vw,5.5rem)] leading-[1.05] tracking-[-0.02em]"
							style={{ animationDelay: "0.2s" }}
						>
							Zeiterfassung,
							<br />
							die <span style={{ color: "#4a9960" }}>w&auml;chst</span>.
						</h1>
						<p
							className="animate-fade-up mt-8 max-w-md text-[15px] leading-[1.9] text-[#5a7a5e]"
							style={{ animationDelay: "0.4s" }}
						>
							Wie ein gut gepflegter Garten: Z8 braucht wenig Aufmerksamkeit, bringt aber stetig
							Ertrag. GoBD-konform, nachhaltig strukturiert.
						</p>
						<div className="animate-fade-up mt-10 flex gap-4" style={{ animationDelay: "0.5s" }}>
							<a href="#contact" className="px-7 py-3.5 text-[11px] font-semibold text-[#0c1a0f] transition-opacity hover:opacity-90" style={{ backgroundColor: "#4a9960" }}>
								Demo anfragen
							</a>
							<a href="#features" className="px-7 py-3.5 text-[11px] text-[#3a6b42] transition-colors hover:text-[#4a9960]">
								Entdecken &darr;
							</a>
						</div>
					</div>

					{/* Hero image */}
					<div className="animate-scale-in relative" style={{ animationDelay: "0.3s" }}>
						<div className="relative h-[55vh] overflow-hidden rounded-sm">
							<Image
								src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1000&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: "saturate(0.5) brightness(0.6) hue-rotate(30deg)" }}
								priority
							/>
							<div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(12,26,15,0.2) 0%, rgba(12,26,15,0.6) 100%)" }} />
						</div>
						{/* Green accent */}
						<div className="absolute -bottom-2 left-8 h-[3px] w-24 rounded-full" style={{ backgroundColor: "#4a9960" }} />
					</div>
				</div>
			</section>

			{/* Green gradient divider */}
			<section className="relative z-10 mx-8 my-16 flex items-center gap-6 lg:mx-16">
				<div className="h-px flex-1" style={{ backgroundColor: "#4a996020" }} />
				<div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#4a9960" }} />
				<div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#4a996060" }} />
				<div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#4a996030" }} />
				<div className="h-px flex-1" style={{ backgroundColor: "#4a996020" }} />
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 pb-24 lg:px-16">
				<div className="mb-16">
					<span className="mb-3 block text-[10px] uppercase tracking-[0.5em] text-[#4a9960]">Funktionen</span>
					<h2 className="text-3xl tracking-tight">Tief verwurzelt.</h2>
				</div>

				<div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
					{[
						{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation auf allen Ger\u00e4ten." },
						{ title: "GoBD-konform", desc: "Revisionssichere, unver\u00e4nderbare Eintr\u00e4ge. L\u00fcckenlos nachvollziehbar." },
						{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Nahtloser Export ohne Handarbeit." },
						{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Jede Organisation isoliert und sicher." },
						{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Sichere Integration in Ihre Infrastruktur." },
						{ title: "Echtzeit-Analyse", desc: "\u00dcberstunden, Trends, Dashboards. Sofort verf\u00fcgbar." },
					].map((f, i) => (
						<div key={i} className="group">
							<div className="mb-4 flex items-center gap-3">
								<div className="h-1.5 w-1.5 rounded-full transition-all duration-500 group-hover:scale-150" style={{ backgroundColor: "#4a9960" }} />
								<h3 className="text-[16px] font-bold tracking-tight">{f.title}</h3>
							</div>
							<p className="pl-[18px] text-[13px] leading-[1.85] text-[#5a7a5e]">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Image triptych */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="grid gap-3 md:grid-cols-3">
					<div className="relative h-52 overflow-hidden rounded-sm">
						<Image src="https://images.unsplash.com/photo-1497215842964-222b430dc094?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.4) brightness(0.6) hue-rotate(20deg)" }} />
					</div>
					<div className="relative h-52 overflow-hidden rounded-sm">
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.4) brightness(0.6) hue-rotate(20deg)" }} />
					</div>
					<div className="relative h-52 overflow-hidden rounded-sm">
						<Image src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=500&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.4) brightness(0.6) hue-rotate(20deg)" }} />
					</div>
				</div>
			</section>

			{/* Roots / philosophy */}
			<section id="roots" className="relative z-10 overflow-hidden px-8 py-24 lg:px-16">
				<div className="absolute inset-0 opacity-[0.04]">
					<Image src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80&auto=format&fit=crop" alt="" fill className="object-cover" />
				</div>
				<div className="relative z-10 mx-auto max-w-xl text-center">
					<div className="mb-6 flex items-center justify-center gap-2">
						<div className="h-1 w-1 rounded-full" style={{ backgroundColor: "#4a9960" }} />
						<div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#4a9960" }} />
						<div className="h-1 w-1 rounded-full" style={{ backgroundColor: "#4a9960" }} />
					</div>
					<blockquote className="text-[clamp(1.4rem,3vw,2.2rem)] leading-[1.4] tracking-tight">
						Nachhaltigkeit in Software bedeutet: Heute bauen, was morgen noch tr&auml;gt.
					</blockquote>
					<div className="mx-auto mt-8 h-px w-16" style={{ backgroundColor: "#4a996030" }} />
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="grid gap-12 lg:grid-cols-2">
					<div>
						<h2 className="mb-6 text-4xl tracking-tight">
							Bereit zu <span style={{ color: "#4a9960" }}>wachsen</span>?
						</h2>
						<p className="max-w-md text-[15px] leading-[1.9] text-[#5a7a5e]">
							In einer pers&ouml;nlichen Demo zeigen wir Ihnen, wie Z8 Ihr Team nachhaltig unterst&uuml;tzt.
						</p>
					</div>
					<div className="flex items-end justify-start lg:justify-end">
						<div className="flex gap-4">
							<a href="mailto:hello@z8.app" className="px-8 py-4 text-[11px] font-semibold text-[#0c1a0f] transition-opacity hover:opacity-90" style={{ backgroundColor: "#4a9960" }}>
								Demo vereinbaren
							</a>
							<a href="mailto:hello@z8.app" className="px-8 py-4 text-[11px] text-[#3a6b42] transition-colors hover:text-[#4a9960]">
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #4a996015" }}>
				<div className="flex items-center justify-between text-[10px] tracking-[0.2em] text-[#2d5a35]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#4a9960]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
