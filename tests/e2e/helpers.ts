import { expect, type Page, type Route } from "./auth-fixture";

/** Open a disclosure through its accessible summary, preserving its current state. */
export async function openDisclosure(page: Page, title: string) {
  const summary = page.locator("summary").filter({ hasText: title === "Edit trip" ? /^Edit trip\b/ : title === "Other options" ? /^Other options \(\d+\)$/ : title });
  await expect(summary).toHaveCount(1);
  if (!(await summary.locator("..").evaluate(element => (element as HTMLDetailsElement).open)))
    await summary.click();
}

export async function demonstrate(page: Page, name: string) {
  await openDisclosure(page, "Try a demonstration");
  await page.getByRole("button", { name, exact: true }).click();
}

export async function openTripEditor(page: Page) {
  const editor = page.locator("summary").filter({ hasText: /^Edit trip(?:\s|$)/ });
  if (await editor.count()) await openDisclosure(page, "Edit trip");
  await expect(page.getByLabel("Gate arrival", { exact: true })).toBeVisible();
}

export async function openPreferences(page: Page) {
  await openTripEditor(page);
  await openDisclosure(page, "Preferences (optional)");
}

/** Exact dated/manual facts are intentionally entered through the advanced path. */
export async function openManualOptions(page: Page) {
  await openTripEditor(page);
  await page.getByLabel("Gate arrival", { exact: true }).selectOption({ label: "Enter a time" });
  await page.getByLabel("Arrival goal", { exact: true }).selectOption({ label: "By a specific time" });
  await openPreferences(page);
  await openDisclosure(page, "Add an option you’ve checked");
  await openDisclosure(page, "Original connection (optional)");
}

export async function openHotelDetails(page: Page) {
  await openDisclosure(page, "Add an option you’ve checked");
}

export async function investigate(page: Page) {
  const start = page.getByRole("button", { name: "Find my options", exact: true });
  if (await start.isVisible()) await start.click();
  else {
    await openTripEditor(page);
    await page.getByRole("button", { name: "Update options", exact: true }).click();
  }
}

export async function compare(page: Page) {
  const manual = page.getByRole("button", { name: "Compare recovery options", exact: true });
  if (await manual.isVisible()) await manual.click();
  else await page.getByRole("button", { name: "Update options", exact: true }).click();
}

/** Browser fixtures obey the same turn/revision binding as the public handler. */
export function echoConversation<T extends object>(route: Route, body: T): T {
  const context = route.request().postDataJSON().conversation;
  return context ? { ...body, conversation: { turnId: context.turnId, baseRevision: context.baseRevision } } : body;
}

/** Alternatives remain inspectable under progressive disclosure. */
export async function revealPlan(page: Page, name: string | RegExp) {
  const button = page.getByRole("button", { name, exact: typeof name === "string", includeHidden: true });
  await expect(button).toHaveCount(1);
  if (!(await button.isVisible())) await openDisclosure(page, "Other options");
  return button;
}

export async function reviewPlan(page: Page, name: string | RegExp) {
  await (await revealPlan(page, name)).click();
}

/** Manual hotel fields are distinct from the progressively revealed inline guide. */
export function manualField(page: Page, label: string) {
  return page.getByRole("region", { name: "Your onward trip", exact: true }).getByLabel(label, { exact: true });
}
