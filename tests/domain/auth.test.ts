import { describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { createAuthController, type AuthApi } from '../../src/features/auth/authState';

const session = (id: string) => ({ access_token: `token-${id}`, user: { id, email: `${id}@example.com` } }) as Session;
const result = (value: Session | null) => ({ data: { session: value }, error: null });
function fixture(initial: Session | null = null) {
  let listener: (event: AuthChangeEvent, session: Session | null) => void = () => {};
  const unsubscribe = vi.fn();
  const api = {
    getSession: vi.fn().mockResolvedValue(result(initial)),
    onAuthStateChange: vi.fn((callback) => { listener = callback; return { data: { subscription: { unsubscribe } } }; }),
    signInWithPassword: vi.fn().mockResolvedValue(result(session('one'))),
    signUp: vi.fn().mockResolvedValue(result(null)),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } satisfies AuthApi;
  const storageUser = vi.fn();
  const controller = createAuthController(api, storageUser);
  return { api, controller, storageUser, unsubscribe, emit: (event: AuthChangeEvent, value: Session | null) => listener(event, value) };
}

describe('account authentication', () => {
  it('restores the SDK session and sets the storage account before notifying the planner', async () => {
    const f = fixture(session('one'));
    f.controller.subscribe(() => {
      expect(f.storageUser).toHaveBeenLastCalledWith(f.controller.getSnapshot().session?.user.id ?? null);
    });
    const stop = f.controller.start();
    expect(f.controller.getSnapshot().loading).toBe(true);
    await Promise.resolve();
    expect(f.controller.getSnapshot().session?.user.id).toBe('one');
    expect(f.controller.getSnapshot().loading).toBe(false);
    stop();
    expect(f.unsubscribe).toHaveBeenCalled();
  });
  it('keeps a confirmation-required signup signed out', async () => {
    const f = fixture();
    await f.controller.submit('signup', ' new@example.com ', 'safe-password');
    expect(f.api.signUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'safe-password' });
    expect(f.controller.getSnapshot().session).toBeNull();
    expect(f.controller.getSnapshot().message).toMatch(/confirm your email/i);
  });
  it('uses a real signup session when confirmation is disabled', async () => {
    const f = fixture();
    f.api.signUp.mockResolvedValueOnce(result(session('new')));
    await f.controller.submit('signup', 'new@example.com', 'safe-password');
    expect(f.controller.getSnapshot().session?.user.id).toBe('new');
    expect(f.storageUser).toHaveBeenLastCalledWith('new');
  });
  it('prevents repeated submission and surfaces invalid credentials', async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.api.signInWithPassword.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as ReturnType<AuthApi['signInWithPassword']>);
    const first = f.controller.submit('signin', 'one@example.com', 'bad-password');
    await f.controller.submit('signin', 'one@example.com', 'bad-password');
    expect(f.api.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().pending).toBe('signin');
    finish({ data: { session: null }, error: { message: 'Invalid login credentials' } });
    await first;
    expect(f.controller.getSnapshot().error).toContain('Invalid login credentials');
    expect(f.controller.getSnapshot().pending).toBeNull();
    expect(f.controller.getSnapshot().session).toBeNull();
  });
  it('hides the current trip immediately while signout is pending, and offers an honest retry on failure', async () => {
    const f = fixture(session('one'));
    f.controller.start();
    await Promise.resolve();
    let finish!: (value: unknown) => void;
    f.api.signOut.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as ReturnType<AuthApi['signOut']>);
    const signingOut = f.controller.signOut();
    expect(f.controller.getSnapshot().session).toBeNull();
    expect(f.storageUser).toHaveBeenLastCalledWith(null);
    finish({ error: { message: 'Offline' } });
    await signingOut;
    expect(f.controller.getSnapshot().error).toMatch(/could not sign out/i);
    expect(f.controller.getSnapshot().session?.user.id).toBe('one');
    await f.controller.signOut();
    expect(f.controller.getSnapshot().session).toBeNull();
  });
  it('applies cross-tab account changes and does not overwrite them with an older session read', async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.api.getSession.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as ReturnType<AuthApi['getSession']>);
    f.controller.start();
    f.emit('SIGNED_IN', session('two'));
    finish(result(session('one')));
    await Promise.resolve();
    expect(f.controller.getSnapshot().session?.user.id).toBe('two');
    f.emit('SIGNED_OUT', null);
    expect(f.controller.getSnapshot().session).toBeNull();
    expect(f.storageUser).toHaveBeenLastCalledWith(null);
  });
  it('allows retry after a failed session restore without showing private content', async () => {
    const f = fixture();
    f.api.getSession.mockRejectedValueOnce(new Error('Network unavailable'));
    f.controller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.controller.getSnapshot().loading).toBe(false);
    expect(f.controller.getSnapshot().error).toMatch(/restore/i);
    expect(f.controller.getSnapshot().session).toBeNull();
    await f.controller.submit('signin', 'one@example.com', 'safe-password');
    expect(f.controller.getSnapshot().session?.user.id).toBe('one');
  });
  it('clears an expired session even when local signout reports an error', async () => {
    const f = fixture(session('one'));
    f.controller.start();
    await Promise.resolve();
    f.api.signOut.mockResolvedValueOnce({ error: { message: 'Invalid JWT' } });
    await f.controller.expireSession();
    expect(f.controller.getSnapshot().session).toBeNull();
    expect(f.storageUser).toHaveBeenLastCalledWith(null);
    expect(f.controller.getSnapshot().error).toMatch(/session has expired/i);
    expect(f.controller.getSnapshot().pending).toBeNull();
  });

  it('honors SDK signout events even when logout returns a server error', async () => {
    const f = fixture(session('one'));
    f.controller.start();
    await Promise.resolve();
    f.api.signOut.mockImplementationOnce(async () => {
      f.emit('SIGNED_OUT', null);
      return { error: { message: 'Logout request failed after local session removal' } };
    });
    await f.controller.signOut();
    expect(f.controller.getSnapshot().session).toBeNull();
    expect(f.storageUser).toHaveBeenLastCalledWith(null);
    expect(f.controller.getSnapshot().error).toMatch(/could not sign out/i);
  });
  it.each(['signout', 'account-change'] as const)('does not restore a late sign-in response after a newer %s event', async (change) => {
    const f = fixture();
    f.controller.start();
    await Promise.resolve();
    let finish!: (value: unknown) => void;
    f.api.signInWithPassword.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as ReturnType<AuthApi['signInWithPassword']>);
    const signingIn = f.controller.submit('signin', 'one@example.com', 'safe-password');
    f.emit('SIGNED_IN', session('one'));
    if (change === 'signout') f.emit('SIGNED_OUT', null);
    else f.emit('SIGNED_IN', session('two'));
    finish(result(session('one')));
    await signingIn;
    expect(f.controller.getSnapshot().session?.user.id ?? null).toBe(change === 'signout' ? null : 'two');
    expect(f.storageUser).toHaveBeenLastCalledWith(change === 'signout' ? null : 'two');
  });

});
