import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

type AuthError = { message: string } | null;
type SessionResult = { data: { session: Session | null }; error: AuthError };
export interface AuthApi {
  getSession(): Promise<SessionResult>;
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): { data: { subscription: { unsubscribe(): void } } };
  signInWithPassword(credentials: { email: string; password: string }): Promise<SessionResult>;
  signUp(credentials: { email: string; password: string }): Promise<SessionResult>;
  signOut(options?: { scope: 'local' }): Promise<{ error: AuthError }>;
}
export type AuthMode = 'signin' | 'signup';
export interface AuthState {
  session: Session | null;
  loading: boolean;
  pending: AuthMode | 'signout' | null;
  error: string | null;
  message: string | null;
}

export function createAuthController(api: AuthApi, setStorageUser: (userId: string | null) => void) {
  let state: AuthState = { session: null, loading: true, pending: null, error: null, message: null };
  let revision = 0;
  const listeners = new Set<() => void>();
  function update(patch: Partial<AuthState>) {
    const next = { ...state, ...patch };
    setStorageUser(next.session?.user.id ?? null);
    state = next;
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      let active = true;
      const { data: { subscription } } = api.onAuthStateChange((_event, session) => {
        if (!active) return;
        revision++;
        if (state.pending === 'signout' && session) return;
        update({ session, loading: false, error: null, message: null });
      });
      const initialRevision = revision;
      api.getSession().then(({ data, error }) => {
        if (!active || revision !== initialRevision) return;
        update({ session: error ? null : data.session, loading: false, error: error ? 'Could not restore your session. Please sign in again.' : null });
      }).catch(() => {
        if (active && revision === initialRevision) update({ session: null, loading: false, error: 'Could not restore your session. Please sign in again.' });
      });
      return () => { active = false; subscription.unsubscribe(); };
    },
    clearFeedback() { update({ error: null, message: null }); },
    async expireSession() {
      if (state.pending === 'signout') return;
      revision++;
      update({ session: null, loading: false, pending: 'signout', error: null, message: null });
      try {
        await api.signOut({ scope: 'local' });
      } catch {
        // A rejected or expired credential must never restore the private planner.
      } finally {
        update({ session: null, pending: null, error: 'Your session has expired. Please sign in again.' });
      }
    },
    async submit(mode: AuthMode, email: string, password: string) {
      if (state.pending) return;
      const submissionRevision = ++revision;
      update({ pending: mode, error: null, message: null });
      try {
        const { data, error } = await (mode === 'signup' ? api.signUp({ email: email.trim(), password }) : api.signInWithPassword({ email: email.trim(), password }));
        // SDK events are authoritative, including events from another tab.
        if (revision !== submissionRevision) return;
        if (error) {
          update({ error: error.message });
        } else if (data.session) {
          update({ session: data.session, loading: false });
        } else if (mode === 'signup') {
          update({ session: null, loading: false, message: 'Check your inbox to confirm your email, then sign in.' });
        } else {
          update({ error: 'Sign in did not create a session. Please try again.' });
        }
      } catch {
        if (revision === submissionRevision) update({ error: 'Could not reach sign in. Check your connection and try again.' });
      } finally {
        if (state.pending === mode) update({ pending: null });
      }
    },
    async signOut() {
      if (state.pending) return;
      const signOutRevision = ++revision;
      const previous = state.session;
      update({ session: null, pending: 'signout', error: null, message: null });
      try {
        const { error } = await api.signOut({ scope: 'local' });
        if (error) update({ ...(revision === signOutRevision ? { session: previous } : {}), error: 'Could not sign out. Please try again.' });
      } catch {
        update({ ...(revision === signOutRevision ? { session: previous } : {}), error: 'Could not sign out. Check your connection and try again.' });
      } finally {
        update({ pending: null, loading: false });
      }
    },
  };
}
export type AuthController = ReturnType<typeof createAuthController>;
