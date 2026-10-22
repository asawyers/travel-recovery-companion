// User session access tokens only; API keys do not authenticate recovery users.
// Kept in the environment and never included in diagnostic messages.
export function recoveryHeaders(headers = {}) {
  const accessToken = process.env.RECOVERY_ACCESS_TOKEN?.trim()
  return {
    'content-type': 'application/json',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    ...headers,
  }
}
