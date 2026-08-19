export const site = {
  name: 'sinkstate',
  domain: 'sinkstate.com',
  tagline: 'Which states can your agent enter but never leave?',
  description: 'Dead-state analysis for agent graphs — LangGraph, CrewAI, n8n and plain state machines.',
};

/** Public origin. Passkey rpID derives from this, so it must match the real host. */
export function siteUrl(): string {
  const env = process.env;
  return env['SITE_URL'] ?? 'http://localhost:3000';
}
