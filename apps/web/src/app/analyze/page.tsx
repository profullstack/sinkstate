import type { Metadata } from 'next';
import { Analyzer } from '@/components/analyzer';

export const metadata: Metadata = {
  title: 'Analyze a graph',
  description:
    'Paste an agent graph and see which states it can enter but never leave. Runs in your browser; nothing is uploaded.',
};

export default function AnalyzePage() {
  return (
    <div className="flex flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Analyze a graph</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Paste a JSON graph, a LangGraph export, an n8n workflow or a mermaid diagram. You get the
          dead set, a concrete path into each dead state, and the four decidable properties.
        </p>
      </div>
      <Analyzer />
    </div>
  );
}
