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
              This planner compares complete journeys between selected U.S. city
              centers. Separate Boston Logan to Portland, Maine examples use
              explicitly labeled fictional and sandbox facts. Schedules,
              estimates, prices and availability may change. Confirm the
              complete journey and payable charges with the operator.
            </p>
            <p>
              No booking or reservation is made. There are no traveler accounts
              or sign-in. Selecting or saving a plan does not purchase tickets,
              reserve seats, rent a car or book a hotel.
            </p>
            <p>
              Google Maps route content is available only during the current
              session and cannot be saved as a device snapshot. Traveler-entered,
              fictional and eligible complete flight itineraries can be saved in
              this browser. Observed flight and hotel search quotes do not
              guarantee seats, rooms or final payable prices.
            </p>
          </>
        ) : (
          <>
            <p>
              Your trip inputs are compared locally or sent to the configured
              public planner when you choose “Find my options,” “Update
              options,” “Recheck available sources,” or send a message. National
              planning uses city center coordinates and explicit origin and
              destination time zones. Relevant current inputs may be sent to
              Google Maps: route, travel time and relevant transport choices for
              route estimates and transit schedules. Explicit flight and overnight
              searches send selected airports, cities, dates, one-adult occupancy
              and relevant search preferences to SerpApi for Google Flights and
              Google Hotels observations. Confirming a selected journey checks
              those quotes again. In the separate Boston airport demo, hotel
              investigations may send stay dates, occupancy and the nationality
              you enter to the enabled hotel source. Submitting a selected hotel
              journey explicitly investigates its availability again. Optional
              sources can be disabled or unavailable.
            </p>
            <p>
              Sending a message sends that text, your current trip inputs and
              bounded recent conversation from this tab to the public planner
              and enabled OpenAI assistance. Conversation text is untrusted
              context; only accepted priority and driving preferences change
              trip facts. Other factual changes require your structured
              confirmation. Messages, conversation, assistance summaries and
              activity are not included in device-saved plans. The labeled
              sandbox Demo guide uses deterministic guidance and test hotel
              rates; it makes no OpenAI or live transport calls.
            </p>
            <p>
              Traveler-entered, fictional and eligible complete flight snapshots are stored in
              localStorage in this browser profile until you delete them or
              clear browser data. Saving a manual plan excludes Google Maps-derived
              alternatives. Google Maps route content is transient in the
              current tab and is not saved in device snapshots. Flight snapshots contain only the selected normalized flight,
              optional hotel and confirmed complete journey, preserving original
              source dates and checks. Other offers, raw responses and conversation
              are excluded. No traveler account or booking record is created.
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
        <p>
          City names, place centers and time zones use{" "}
          <a
            className="underline"
            href="https://www.geonames.org/"
            target="_blank"
            rel="noopener noreferrer"
          >
            GeoNames
          </a>{" "}
          data under{" "}
          <a
            className="underline"
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noopener noreferrer"
          >
            CC BY 4.0
          </a>
          . Searchable places include inhabited communities and U.S.
          territories. Routes use city center estimates, not a traveler’s street
          address.
        </p>
        <a className="inline-block underline" href="/">
          Return to planner
        </a>
      </main>
      <LegalFooter />
    </>
  );
}
