import type { CitySavedSelection } from "@domain/city-contracts";
import { Button } from "@/components/ui/button";
import { SavedPlanPanel } from "../recovery/SavedPlanPanel";
import type { CityHistory } from "./savedSelection";
import { CityPlanCard } from "./CityPlanCard";
export function CityHistoryPanel({
  saved,
  busy,
  configured,
  onDelete,
  onRefresh,
}: {
  saved: CityHistory;
  busy: boolean;
  configured: boolean;
  onDelete: () => void;
  onRefresh: (saved: CitySavedSelection) => void;
}) {
  if (saved.schemaVersion === 1)
    return (
      <SavedPlanPanel
        saved={saved}
        busy={busy}
        configured={configured}
        onDelete={onDelete}
        onRefresh={() => {
          window.location.assign("/legacy?refreshSaved=1");
        }}
      />
    );
  return (
    <section
      data-testid="saved-plan"
      aria-labelledby="saved-city-heading"
      className="space-y-4 rounded-lg border bg-slate-50 p-4"
    >
      <h2 id="saved-city-heading" className="text-lg font-semibold">
        Saved on this device
      </h2>
      <p className="text-sm">
        Historical snapshot of {saved.origin.name}, {saved.origin.stateCode} to{" "}
        {saved.destination.name}, {saved.destination.stateCode}. Recheck all
        facts before choosing or booking. Refresh uses the original cities, trip
        times and source check timestamps.
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
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onRefresh(saved)}
        >
          Refresh this plan
        </Button>
        <Button variant="outline" onClick={onDelete}>
          Delete saved plan
        </Button>
      </div>
      <CityPlanCard
        plan={saved.plan}
        origin={saved.origin}
        destination={saved.destination}
        historical
      />
    </section>
  );
}
