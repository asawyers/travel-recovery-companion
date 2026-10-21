export function LegalFooter() {
  return (
    <footer className="mx-auto flex max-w-7xl gap-5 border-t px-4 py-5 text-sm sm:px-6">
      <a className="underline" href="/terms">
        Terms
      </a>
      <a className="underline" href="/privacy">
        Privacy
      </a>
    </footer>
  );
}
export function LegalPage({ page }: { page: "terms" | "privacy" }) {
  return (
    <>
      <header className="border-b border-t-4 border-t-[#153247] bg-white p-5">
        <a className="font-semibold underline" href="/">
          Travel recovery companion
        </a>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-5 py-8 text-sm leading-relaxed">
        <h1 className="text-2xl font-semibold">
          {page === "terms" ? "Terms" : "Privacy"}
        </h1>
        {page === "terms" ? (
          <>
            <p>
              This planner helps compare supplied journey facts for Boston Logan
              to Portland, Maine. Schedules, estimates, prices and availability
              may change. Confirm the complete journey and payable charges with
              the operator.
            </p>
            <p>
              No booking or reservation is made. There are no traveler accounts
              or sign-in. Selecting or saving a plan does not purchase tickets,
              reserve seats, rent a car or book a hotel.
            </p>
            <p>
              Google Maps route content is available only during the current
              session and cannot be saved as a device snapshot. Traveler-entered
              and fictional itineraries can be saved in this browser.
            </p>
          </>
        ) : (
          <>
            <p>
              Your trip inputs are compared locally or sent to the configured
              public planner when you compare. When you explicitly choose
              “Investigate available sources,” relevant current inputs may be
              sent to Google Maps: route, travel time and relevant transport
              choices for route estimates and transit schedules. This optional
              service can be disabled or unavailable.
            </p>
            <p>
              Traveler-entered and fictional device snapshots are stored in
              localStorage in this browser profile until you delete them or
              clear browser data. Saving a manual plan excludes Google-derived
              alternatives. Google Maps route content is transient in the
              current tab and is not saved in device snapshots. No traveler
              account or booking record is created.
            </p>
            <p>
              Provider keys stay on the server. External operator links open
              their services, which apply their own privacy policies.
            </p>
          </>
        )}
        <p>
          Use of Google Maps content is subject to{" "}
          <a
            className="underline"
            href="https://www.google.com/help/terms_maps/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Maps terms
          </a>{" "}
          and the{" "}
          <a
            className="underline"
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Privacy Policy
          </a>
          .
        </p>
        <a className="inline-block underline" href="/">
          Return to planner
        </a>
      </main>
      <LegalFooter />
    </>
  );
}
