/** Synthetic SDK sessions only. No test token is accepted by a real Supabase project. */
export const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
export const AUTH_SECOND_USER_ID = "22222222-2222-4222-8222-222222222222";
export const AUTH_EMAIL = "browser-fixture@example.test";
export const AUTH_STORAGE_KEY = "sb-isclmlhsktuocgdoizmc-auth-token";
export const SAVED_PLAN_KEY = `travel-recovery:selected:v1:account:${AUTH_USER_ID}`;
export function fakeSession(id = AUTH_USER_ID, email = AUTH_EMAIL) {
  const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const access_token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    sub: id, email, role: "authenticated", aud: "authenticated", iat: 1767225600,
    exp: 4070908800, iss: "https://isclmlhsktuocgdoizmc.supabase.co/auth/v1",
  })}.synthetic-browser-fixture-signature`;
  return {
    access_token, token_type: "bearer", expires_in: 315360000, expires_at: 4070908800,
    refresh_token: `synthetic-refresh-${id}`,
    user: { id, aud: "authenticated", role: "authenticated", email,
      email_confirmed_at: "2026-01-01T00:00:00.000Z", phone: "",
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
      identities: [], created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" },
  };
}
export const AUTH_ACCESS_TOKEN = fakeSession().access_token;
