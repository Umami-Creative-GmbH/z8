import Image from "next/image";
import Link from "next/link";

export default function Design18() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Cambria', 'Hoefler Text', 'Georgia', serif",
				backgroundColor: "#1c1f26",
				color: "#d8cfc5",
			}}
		>
			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-6 lg:px-16">
				<div className="flex items-baseline gap-3">
					<span className="text-2xl font-bold tracking-tight" style={{ color: "#c87533" }}>Z8</span>
					<span className="text-[10px] uppercase tracking-[0.4em] text-[#5a5550]">Zeitwirtschaft</span>
				</div>
				<nav className="hidden items-center gap-10 text-[12px] tracking-wide text-[#5a5550] md:flex">
					<a href="#features" className="transition-colors hover:text-[#c87533]">Funktionen</a>
					<a href="#material" className="transition-colors hover:text-[#c87533]">Material</a>
					<a href="#contact" className="transition-colors hover:text-[#c87533]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-all hover:bg-[#c87533] hover:text-[#1c1f26]"
					style={{ border: "1px solid #c87533", color: "#c87533" }}
				>
					Anfragen
				</a>
			</header>

			<div className="mx-8 h-px lg:mx-16" style={{ backgroundColor: "#c8753315" }} />

			{/* Hero */}
			<section className="relative z-10 px-8 pb-16 pt-24 lg:px-16">
				<div className="grid gap-12 lg:grid-cols-12">
					<div className="lg:col-span-6">
						<p
							className="animate-fade-up mb-8 text-[10px] uppercase tracking-[0.5em]"
							style={{ color: "#c87533", animationDelay: "0.1s" }}
						>
							Kupfer &amp; Stein
						</p>
						<h1
							className="animate-fade-up text-[clamp(3rem,7vw,5.5rem)] leading-[1.05] tracking-[-0.02em]"
							style={{ animationDelay: "0.2s" }}
						>
							Geschmiedet
							<br />
							f&uuml;r <span style={{ color: "#c87533" }}>Best&auml;ndigkeit</span>.
						</h1>
						<p
							className="animate-fade-up mt-8 max-w-md text-[14px] leading-[1.9] text-[#6a6560]"
							style={{ animationDelay: "0.4s" }}
						>
							Wie Kupfer, das mit der Zeit sch&ouml;ner wird. Z8 ist Zeiterfassung, die
							auf Dauer gebaut ist. GoBD-konform, revisionssicher, unverw&uuml;stlich.
						</p>
						<div className="animate-fade-up mt-10 flex gap-4" style={{ animationDelay: "0.5s" }}>
							<a href="#contact" className="px-7 py-3.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#1c1f26]" style={{ backgroundColor: "#c87533" }}>
								Demo anfragen
							</a>
							<a href="#features" className="px-7 py-3.5 text-[11px] tracking-[0.2em] text-[#5a5550] transition-colors hover:text-[#c87533]">
								Mehr &darr;
							</a>
						</div>
					</div>

					<div className="animate-scale-in relative lg:col-span-6" style={{ animationDelay: "0.3s" }}>
						<div className="relative h-[55vh] overflow-hidden">
							<Image
								src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1000&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: "saturate(0.6) brightness(0.7) sepia(0.2)" }}
								priority
							/>
							<div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(28,31,38,0.4) 0%, transparent 100%)" }} />
						</div>
						{/* Copper accent lines */}
						<div className="absolute -left-3 top-8 h-32 w-[3px]" style={{ backgroundColor: "#c87533" }} />
						<div className="absolute -bottom-3 right-8 h-[3px] w-32" style={{ backgroundColor: "#c87533" }} />
					</div>
				</div>
			</section>

			{/* Copper divider */}
			<section className="relative z-10 mx-8 my-20 flex items-center gap-6 lg:mx-16">
				<div className="h-px flex-1" style={{ backgroundColor: "#c8753320" }} />
				<div className="h-2 w-2 rotate-45" style={{ backgroundColor: "#c87533" }} />
				<div className="h-px flex-1" style={{ backgroundColor: "#c8753320" }} />
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 pb-24 lg:px-16">
				<div className="mb-16">
					<span className="mb-3 block text-[10px] uppercase tracking-[0.5em] text-[#c87533]">Module</span>
					<h2 className="text-3xl tracking-tight">Robust konstruiert.</h2>
				</div>

				<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
					{[
						{ title: "Stempeluhr", desc: "Multi-Plattform. Echtzeit-Sync. Ein Klick." },
						{ title: "GoBD-Konform", desc: "Revisionssicher. WORM. Digital signiert." },
						{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Nahtlos." },
						{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Isoliert. Performant." },
						{ title: "SSO & SCIM", desc: "SAML, OIDC. Auto-Provisioning. Passkeys." },
						{ title: "Dashboards", desc: "\u00dcberstunden, Trends, Auslastung. Live." },
					].map((f, i) => (
						<div
							key={i}
							className="group p-6 transition-all hover:translate-x-1"
							style={{ borderLeft: "2px solid #c8753330" }}
						>
							<h3 className="mb-2 text-[16px] font-bold tracking-tight">{f.title}</h3>
							<p className="text-[13px] leading-[1.8] text-[#5a5550]">{f.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* Material - images */}
			<section id="material" className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="grid gap-3 md:grid-cols-3">
					<div className="relative h-56 overflow-hidden">
						<Image src="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.5) sepia(0.2) brightness(0.7)" }} />
						<div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 50%, rgba(28,31,38,0.5) 100%)" }} />
						<span className="absolute bottom-3 left-4 text-[9px] uppercase tracking-[0.4em]" style={{ color: "#c87533" }}>Infrastruktur</span>
					</div>
					<div className="relative h-56 overflow-hidden">
						<Image src="https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=600&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.5) sepia(0.2) brightness(0.7)" }} />
						<div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 50%, rgba(28,31,38,0.5) 100%)" }} />
						<span className="absolute bottom-3 left-4 text-[9px] uppercase tracking-[0.4em]" style={{ color: "#c87533" }}>Handwerk</span>
					</div>
					<div className="relative h-56 overflow-hidden">
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.5) sepia(0.2) brightness(0.7)" }} />
						<div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 50%, rgba(28,31,38,0.5) 100%)" }} />
						<span className="absolute bottom-3 left-4 text-[9px] uppercase tracking-[0.4em]" style={{ color: "#c87533" }}>Zusammenarbeit</span>
					</div>
				</div>
			</section>

			{/* Quote */}
			<section className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-xl text-center">
					<span className="mb-6 block text-5xl leading-none" style={{ color: "#c87533" }}>&ldquo;</span>
					<blockquote className="text-[clamp(1.4rem,3vw,2.2rem)] leading-[1.4] tracking-tight">
						Best&auml;ndigkeit entsteht nicht durch Zufall, sondern durch bewusste Entscheidungen.
					</blockquote>
					<div className="mx-auto mt-8 flex items-center justify-center gap-3">
						<div className="h-px w-8" style={{ backgroundColor: "#c8753330" }} />
						<div className="h-2 w-2 rotate-45" style={{ backgroundColor: "#c87533" }} />
						<div className="h-px w-8" style={{ backgroundColor: "#c8753330" }} />
					</div>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="grid gap-12 lg:grid-cols-2">
					<div>
						<h2 className="mb-6 text-4xl tracking-tight">
							Bereit f&uuml;r <span style={{ color: "#c87533" }}>Qualit&auml;t</span>?
						</h2>
						<p className="max-w-md text-[14px] leading-[1.9] text-[#5a5550]">
							Wir zeigen Ihnen Z8 in einer pers&ouml;nlichen Demo. Massiv gebaut, dauerhaft zuverl&auml;ssig.
						</p>
					</div>
					<div className="flex items-end justify-start lg:justify-end">
						<a href="mailto:hello@z8.app" className="px-8 py-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[#1c1f26] transition-opacity hover:opacity-90" style={{ backgroundColor: "#c87533" }}>
							Demo vereinbaren
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid #c8753315" }}>
				<div className="flex items-center justify-between text-[10px] tracking-[0.2em] text-[#3a3530]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#c87533]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
