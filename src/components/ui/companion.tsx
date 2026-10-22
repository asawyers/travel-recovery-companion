import { CheckCircle2, Circle, CircleAlert, CircleX, LoaderCircle } from "lucide-react";
import type { AgentActivity } from "@domain/assistance";
import { cn } from "@/lib/utils";

export function CompanionAvatar({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span className={cn("companion-avatar", size === "sm" && "companion-avatar-sm", className)} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none" focusable="false">
        <path d="M8 25V13a5 5 0 0 1 5-5h10M18 3l5 5-5 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="25" r="3" fill="currentColor" />
      </svg>
    </span>
  );
}

export function LoadingSpinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("companion-spinner", className)} aria-hidden="true" focusable="false" />;
}

export function CompanionStatus({ label, detail, className }: { label: string; detail?: string; className?: string }) {
  return (
    <div className={cn("companion-status", className)} role="status" aria-live="polite" aria-atomic="true">
      <LoadingSpinner />
      <div>
        <p className="companion-status-label">{label}</p>
        {detail && <p className="companion-status-detail">{detail}</p>}
      </div>
    </div>
  );
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function PriceHighlight({ amountCents, label, qualifier, className }: { amountCents: number | null; label: string; qualifier?: string; className?: string }) {
  return (
    <div className={cn("companion-price-block", className)} role="group" aria-label={label}>
      <p className="companion-price-label">{label}</p>
      <p className={cn("companion-price", amountCents === null && "companion-price-unknown")}>
        {amountCents === null ? "Price unknown" : usd.format(amountCents / 100)}
      </p>
      {qualifier && <p className="companion-price-qualifier">{qualifier}</p>}
    </div>
  );
}

const toolLabels: Record<AgentActivity["tool"], string> = {
  find_transport_options: "Transport options",
  find_hotel_options: "Places to stay",
  assess_recovery_options: "Recovery comparison",
  model: "Travel companion",
};
const statusLabels: Record<AgentActivity["status"], string> = {
  started: "Started", completed: "Completed", unavailable: "Unavailable", limited: "Limited",
};
const statusIcons = { started: Circle, completed: CheckCircle2, unavailable: CircleX, limited: CircleAlert };

export function AgentActivityList({ activity, className }: { activity: AgentActivity[]; className?: string }) {
  if (activity.length === 0) return null;
  // These are returned records, not a live stream. A recorded start never implies ongoing work.
  const latestByTool = new Map<AgentActivity["tool"], AgentActivity>();
  for (const record of activity) latestByTool.set(record.tool, record);
  return (
    <div className={cn("companion-activity", className)}>
      <p className="companion-activity-label">Recorded activity</p>
      <ul className="companion-activity-summary" aria-label="Recorded agent activity">
        {Array.from(latestByTool.values(), (record) => {
          const Icon = statusIcons[record.status];
          return (
            <li key={record.tool} className="companion-activity-item" data-activity-status={record.status}>
              <Icon aria-hidden="true" focusable="false" />
              <span>{toolLabels[record.tool]}</span>
              <span className="companion-activity-status">{statusLabels[record.status]}</span>
            </li>
          );
        })}
      </ul>
      <details className="companion-activity-details">
        <summary>View activity details</summary>
        <ol>
          {activity.map((record, index) => (
            <li key={`${record.tool}-${record.checkedAt}-${index}`}>
              <p>{record.message}</p>
              <p className="companion-activity-record-meta">
                {toolLabels[record.tool]}: {statusLabels[record.status]} <time dateTime={record.checkedAt}>{record.checkedAt}</time>
              </p>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
