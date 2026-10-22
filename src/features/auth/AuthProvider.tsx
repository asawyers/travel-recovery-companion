import { createContext, Fragment, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowRight, LogOut, MapPinned } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LegalFooter } from '@/features/recovery/LegalPage';
import { setPlanStorageUser } from '@/lib/account-storage';
import { supabase } from '@/lib/supabase';
import { createAuthController } from './authState';
import type { AuthController, AuthMode, AuthState } from './authState';

type AuthContextValue = AuthState & Pick<AuthController, 'submit' | 'signOut' | 'clearFeedback'>;
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => createAuthController(supabase.auth, setPlanStorageUser));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    const stop = controller.start();
    const expireSession = () => { void controller.expireSession(); };
    window.addEventListener('recovery:auth-required', expireSession);
    return () => {
      stop();
      window.removeEventListener('recovery:auth-required', expireSession);
    };
  }, [controller]);
  return <AuthContext.Provider value={{ ...state, submit: controller.submit, signOut: controller.signOut, clearFeedback: controller.clearFeedback }}>{children}</AuthContext.Provider>;
}

// Header components also render independently in the planner's component tests.
export function useAuth() { return useContext(AuthContext); }

export function ProtectedApp({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth || auth.loading || auth.pending === 'signout') {
    return <main className="flex min-h-dvh items-center justify-center bg-[#f4f1e9] p-6"><p role="status" className="text-sm text-muted-foreground">{auth?.pending === 'signout' ? 'Signing out…' : 'Restoring your session…'}</p></main>;
  }
  if (!auth.session) return <AuthScreen />;
  return <Fragment key={auth.session.user.id}>{children}</Fragment>;
}

export function AccountControls() {
  const auth = useAuth();
  if (!auth?.session) return null;
  return <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
    <span className="max-w-52 truncate text-muted-foreground" title={auth.session.user.email}>{auth.session.user.email}</span>
    <Button type="button" variant="outline" size="sm" disabled={!!auth.pending} onClick={() => void auth.signOut()}><LogOut aria-hidden="true" />Sign out</Button>
    {auth.error && <p role="alert" className="w-full text-right text-xs text-destructive">{auth.error}</p>}
  </div>;
}

function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  if (!auth) return null;
  const signingUp = mode === 'signup';
  const pending = !!auth.pending;
  function switchMode() {
    auth!.clearFeedback();
    setPassword('');
    setMode(signingUp ? 'signin' : 'signup');
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void auth!.submit(mode, email, password);
  }
  return <div className="flex min-h-dvh flex-col bg-[#f4f1e9]">
    <header className="border-t-4 border-t-[#153247] px-5 py-6 sm:px-8"><a href="/" className="inline-flex items-center gap-2 font-heading text-sm font-semibold text-[#153247]"><MapPinned aria-hidden="true" className="size-5" />Travel recovery companion</a></header>
    <main className="flex flex-1 items-center justify-center px-5 py-8 sm:py-12">
      <section className="w-full max-w-md rounded-2xl border bg-white p-7 shadow-sm sm:p-9" aria-labelledby="auth-title">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#5d6e77]">Your next way forward</p>
        <h1 id="auth-title" className="font-heading text-2xl font-semibold tracking-tight text-[#153247]">{signingUp ? 'Create your account' : 'Sign in to plan your trip'}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{signingUp ? 'Use your email and a password to get started.' : 'Compare complete journeys and keep your saved plans separate on this device.'}</p>
        <form onSubmit={submit} className="mt-7 space-y-5" aria-busy={pending}>
          <div className="space-y-2"><label htmlFor="auth-email" className="block text-sm font-medium">Email</label><Input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} className="h-11" /></div>
          <div className="space-y-2"><label htmlFor="auth-password" className="block text-sm font-medium">Password</label><Input id="auth-password" name="password" type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} required minLength={signingUp ? 6 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} className="h-11" />{signingUp && <p className="text-xs text-muted-foreground">Use at least 6 characters.</p>}</div>
          {auth.error && <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{auth.error}</p>}
          {auth.message && <p role="status" className="rounded-lg bg-[#edf4f1] p-3 text-sm text-[#245747]">{auth.message}</p>}
          <Button type="submit" disabled={pending} className="h-11 w-full bg-[#153247] text-white hover:bg-[#25495f]">{pending ? (signingUp ? 'Creating account…' : 'Signing in…') : (signingUp ? 'Create account' : 'Sign in')}<ArrowRight aria-hidden="true" /></Button>
        </form>
        <div className="mt-5 text-center"><Button type="button" variant="link" disabled={pending} onClick={switchMode}>{signingUp ? 'Back to sign in' : 'Create an account'}</Button></div>
        <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">Saved plans stay in this browser. Signing in on another device does not sync them.</p>
      </section>
    </main>
    <LegalFooter />
  </div>;
}
