import { Switch, Route, Router as WouterRouter, Link } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import privacyMd from "../../../docs/app-store/privacy-policy.md?raw";
import termsMd from "../../../docs/app-store/terms-of-service.md?raw";
import supportMd from "../../../docs/app-store/support.md?raw";

function Header() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold text-slate-900 no-underline">
          My Car Concierge
        </Link>
        <nav className="flex gap-6 text-sm">
          <Link href="/privacy" className="text-slate-600 hover:text-slate-900 no-underline">
            Privacy
          </Link>
          <Link href="/terms" className="text-slate-600 hover:text-slate-900 no-underline">
            Terms
          </Link>
          <Link href="/support" className="text-slate-600 hover:text-slate-900 no-underline">
            Support
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white mt-16">
      <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-sm text-slate-500">
        <div>© {new Date().getFullYear()} My Car Concierge, LLC. All rights reserved.</div>
        <div className="flex gap-5">
          <Link href="/privacy" className="hover:text-slate-900 no-underline">Privacy</Link>
          <Link href="/terms" className="hover:text-slate-900 no-underline">Terms</Link>
          <Link href="/support" className="hover:text-slate-900 no-underline">Support</Link>
        </div>
      </div>
    </footer>
  );
}

function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <section className="py-12 sm:py-20">
        <p className="text-sm font-medium uppercase tracking-wider text-blue-700">
          Premium vehicle concierge
        </p>
        <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
          Your car, handled.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-600 leading-relaxed">
          My Car Concierge dispatches vetted professional drivers to handle the
          everyday driving you'd rather not — service appointments, airport runs,
          errands, and member rides — all on demand.
        </p>
      </section>

      <section className="grid sm:grid-cols-3 gap-4 mt-8">
        <PolicyCard
          href="/privacy"
          title="Privacy Policy"
          body="How we collect, use, and protect driver information."
        />
        <PolicyCard
          href="/terms"
          title="Terms of Service"
          body="The driver agreement for using the My Car Concierge Driver app."
        />
        <PolicyCard
          href="/support"
          title="Driver Support"
          body="Common questions and how to reach our 24/7 support team."
        />
      </section>
    </main>
  );
}

function PolicyCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-slate-200 bg-white p-6 hover:border-blue-500 hover:shadow-md transition no-underline"
    >
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-600 leading-relaxed">{body}</p>
      <span className="mt-4 inline-block text-sm font-medium text-blue-700">
        Read &rarr;
      </span>
    </Link>
  );
}

function LegalPage({ title, source }: { title: string; source: string }) {
  if (typeof document !== "undefined") {
    document.title = `${title} — My Car Concierge`;
  }
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <article className="legal-prose bg-white rounded-xl border border-slate-200 p-8 sm:p-12">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
      </article>
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24 text-center">
      <h1 className="text-3xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-3 text-slate-600">
        The page you're looking for doesn't exist.{" "}
        <Link href="/" className="text-blue-700 underline">
          Go home
        </Link>
        .
      </p>
    </main>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/privacy">
        <LegalPage title="Privacy Policy" source={privacyMd} />
      </Route>
      <Route path="/terms">
        <LegalPage title="Terms of Service" source={termsMd} />
      </Route>
      <Route path="/support">
        <LegalPage title="Driver Support" source={supportMd} />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1">
          <Router />
        </div>
        <Footer />
      </div>
    </WouterRouter>
  );
}

export default App;
