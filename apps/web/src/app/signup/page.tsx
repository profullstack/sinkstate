import { SignInPanels } from '@/components/sign-in-panels';

export const metadata = { title: 'Sign up' };

// A mechanism with no name reads to a new visitor as "this site has no
// accounts", so sign-up exists as its own page even though the magic link
// already registers. Same component, different wording.
export default function SignupPage() {
  return <SignInPanels mode="signup" />;
}
