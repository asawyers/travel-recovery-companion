/** Google route content stays in this tab and cannot enter device snapshots. */
export const GOOGLE_ROUTES_PROVIDER = "Google Maps Routes API";
export const GOOGLE_SAVE_MESSAGE =
  "Google Maps route content cannot be saved on this device. Choose a traveler-entered or fictional plan to save; your previous saved plan is retained.";
export function containsGoogleRoutes(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsGoogleRoutes);
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return (
      item.provider === GOOGLE_ROUTES_PROVIDER ||
      Object.values(item).some(containsGoogleRoutes)
    );
  }
  return false;
}
