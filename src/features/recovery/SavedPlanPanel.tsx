import type { SavedSelection } from "./savedSelection";
import { ItineraryPanel } from "./ItineraryPanel";
import { Button } from "@/components/ui/button";
import { toInstantMillis } from "@domain/time";
export function SavedPlanPanel({
  saved,
  onDelete,
  onRefresh,
  busy,
  configured,
}: {
  saved: SavedSelection;
  onDelete: () => void;
  onRefresh: () => void;
  busy: boolean;
  configured: boolean;
}) {
  const hotelSandbox = saved.request.hotelDataMode === "sandbox";
  const expired =
    saved.plan.evidenceExpiresAt &&
    toInstantMillis(saved.plan.evidenceExpiresAt) <= Date.now();
  return (
    <section
      data-testid="saved-plan"
      aria-labelledby="saved-plan-heading"
      className="space-y-4 rounded-lg border border-slate-300 bg-slate-50 p-4"
    >
      <h2 id="saved-plan-heading" className="text-lg font-semibold">
        Saved on this device
      </h2>
      <p className="text-sm">
        Historical snapshot{expired ? " · Evidence expired" : ""}. Saved in this
        browser profile on this device only. Clearing browser data removes it.
        {hotelSandbox ? "Sandbox / test itinerary. All rates and onward inputs remain test data; no bookings are available." : "Refresh and recheck all facts before choosing or booking."}
      </p>
      <dl className="space-y-1 break-words text-xs text-muted-foreground">
        <div>
          <dt className="inline font-medium">Originally compared: </dt>
          <dd className="inline">{saved.generatedAt}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Selected and saved: </dt>
          <dd className="inline">{saved.selectedAt}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={onRefresh}>
          Refresh this plan
        </Button>
        <Button variant="outline" onClick={onDelete}>
          Delete saved plan
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {hotelSandbox
          ? configured ? "Refresh explicitly checks sandbox hotel rates with the current clock and the original dates and source timestamps. The historical saved record is retained. No live availability or bookings." : "Sandbox source unavailable: configure the public planner to retrieve test hotel rates. Refresh compares original fictional inputs locally."
          : configured
          ? "Refresh asks the public planner to investigate available sources and compare the original inputs. Sources may be unavailable; warnings report what was checked. Original source timestamps are retained."
          : "Refresh starts a new local comparison with the original source timestamps. Previous provider checks need manual reconfirmation; no live availability is fetched."}
      </p>
      <ItineraryPanel
        plan={saved.plan}
        request={saved.request}
        presentation="historical"
      />
    </section>
  );
}
