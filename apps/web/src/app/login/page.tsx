import { SignInPanels } from '@/components/sign-in-panels';

export const metadata = { title: 'Sign in' };

export default function LoginPage() {
  return <SignInPanels mode="login" />;
}
