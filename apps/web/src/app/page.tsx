import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { site } from '@/lib/site';

const FEATURES = [
  { title: 'Reachable', body: 'Can the graph finish at all? A reverse breadth-first search from your goal states.' },
  { title: 'Branch-stable', body: 'Can every state it can enter still finish? This is the one that catches real bugs.' },
  { title: 'Safe-reachable', body: 'Is there a path to done that never crosses a state you marked unsafe?' },
  { title: 'Witness paths', body: 'Not just a boolean — the concrete path into the dead state, and the unsafe cut every route must cross.' },
  { title: 'Your framework', body: 'Adapters for LangGraph, CrewAI, n8n and mermaid, plus a plain JSON graph format that always works.' },
  { title: 'In your CI', body: 'npx sinkstate exits non-zero when a property fails, so it drops into a pipeline unchanged.' },
];

export default function Home() {
  return (
    <>
      <section className="flex flex-col items-start gap-6 py-24">
        <p className="text-sm font-medium text-muted-foreground">Agent graph analysis</p>
        <h1 className="max-w-3xl text-balance text-5xl font-semibold tracking-tight sm:text-6xl">
          {site.tagline}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{site.description}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/analyze" className={buttonVariants({ size: 'lg' })}>
            Analyze a graph
          </Link>
          <Link href="/docs" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Read the docs
          </Link>
        </div>
      </section>

      <section className="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <CardTitle>{f.title}</CardTitle>
              <CardDescription>{f.body}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </section>
    </>
  );
}
