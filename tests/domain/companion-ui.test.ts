import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentActivity } from "@domain/assistance";
import { AgentActivityList, CompanionAvatar, CompanionStatus, LoadingSpinner, PriceHighlight } from "../../src/components/ui/companion";

const render = (component: Parameters<typeof createElement>[0], props = {}) => renderToStaticMarkup(createElement(component, props));

const transportStarted: AgentActivity = {
  tool: "find_transport_options", status: "started", message: "Searching the supplied routes.", checkedAt: "2026-10-22T12:00:00Z",
};

describe("companion shared interface", () => {
  it("keeps an unknown fare distinct from an actual zero fare", () => {
    const unknown = render(PriceHighlight, { amountCents: null, label: "Flight fare", qualifier: "Per traveler" });
    expect(unknown).toContain("Price unknown");
    expect(unknown).not.toContain("$0.00");
    expect(unknown).toContain("Flight fare");
    expect(unknown).toContain("Per traveler");
    expect(render(PriceHighlight, { amountCents: 0, label: "Known cost" })).toContain("$0.00");
    expect(render(PriceHighlight, { amountCents: 12345, label: "Known cost" })).toContain("$123.45");
  });

  it("announces actual pending work with readable status text and decorative motion", () => {
    const status = render(CompanionStatus, { label: "Checking your routes", detail: "This can take a moment." });
    expect(status).toContain('role="status"');
    expect(status).toContain('aria-live="polite"');
    expect(status).toContain("Checking your routes");
    expect(status).toContain("This can take a moment.");
    const spinner = render(LoadingSpinner);
    expect(spinner).toContain('aria-hidden="true"');
    expect(render(CompanionAvatar)).toContain('aria-hidden="true"');
  });

  it("does not invent activity when no tool records were received", () => {
    expect(render(AgentActivityList, { activity: [] })).toBe("");
  });

  it("summarizes the last received status per tool while retaining every message and timestamp", () => {
    const activity: AgentActivity[] = [transportStarted,
      { ...transportStarted, status: "completed", message: "Found two supplied routes.", checkedAt: "2026-10-22T12:00:01Z" },
      { tool: "find_hotel_options", status: "unavailable", message: "Hotel source unavailable.", checkedAt: "2026-10-22T12:00:02Z" },
      { tool: "assess_recovery_options", status: "limited", message: "Comparison needs a departure time.", checkedAt: "2026-10-22T12:00:03Z" },
    ];
    const html = render(AgentActivityList, { activity });
    expect(html.match(/<ul[^>]*>[\s\S]*?<\/ul>/)?.[0].match(/Transport options/g)).toHaveLength(1);
    expect(html).toContain("Completed");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Limited");
    for (const record of activity) {
      expect(html).toContain(record.message);
      expect(html.toLowerCase()).toContain(`datetime="${record.checkedAt}"`.toLowerCase());
    }
    expect(html).toContain("<details");
    expect(html).not.toContain("companion-spinner");
    expect(html).not.toContain("Travel companion</");
  });

  it("associates each interleaved activity detail with its originating tool", () => {
    const activity: AgentActivity[] = [transportStarted,
      { tool: "find_hotel_options", status: "limited", message: "Hotel check needs dates.", checkedAt: "2026-10-22T12:00:01Z" },
      { ...transportStarted, status: "completed", message: "Transport check returned routes.", checkedAt: "2026-10-22T12:00:02Z" },
    ];
    const html = render(AgentActivityList, { activity });
    const details = html.match(/<details[\s\S]*?<\/details>/)?.[0] ?? "";
    const rows = details.match(/<li>[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(3);
    for (const [index, tool] of ["Transport options", "Places to stay", "Transport options"].entries()) {
      expect(rows[index]).toContain(tool);
      expect(rows[index]).toContain(activity[index].message);
      expect(rows[index]).toContain(activity[index].checkedAt);
    }
    expect(rows[1]).not.toContain("Transport options");
    expect(rows[2]).not.toContain("Places to stay");
  });

  it("keeps a recorded start historical without claiming completion or continuing to spin", () => {
    const html = render(AgentActivityList, { activity: [transportStarted] });
    expect(html).toContain("Started");
    expect(html).not.toContain("Completed");
    expect(html).not.toContain("companion-spinner");
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("Places to stay");
  });
});
