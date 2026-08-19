export const metadata = { title: 'Docs' };

export default function DocsPage() {
  return (
    <article className="prose-neutral max-w-2xl py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Docs</h1>
      <p className="mt-4 text-muted-foreground">
        Dead-state analysis for agent graphs — LangGraph, CrewAI, n8n and plain state machines.
      </p>
      <h2 className="mt-10 text-xl font-semibold tracking-tight">API</h2>
      <p className="mt-2 text-muted-foreground">
        The API is unauthenticated and lives under <code>/api</code>. Start with{' '}
        <code>/api/health</code>.
      </p>
      <h2 className="mt-10 text-xl font-semibold tracking-tight">Feed</h2>
      <p className="mt-2 text-muted-foreground">
        <code>/feed.xml</code> is a plain RSS 2.0 document.
      </p>
    </article>
  );
}
