import { test, expect } from "./auth-fixture";
import { buildHotelRecovery } from "../../supabase/functions/_shared/domain/hotel-recovery";
import { daytimeFixture, overnightFixture } from "../../supabase/functions/_shared/domain/fixtures";
import { planRecovery } from "../../supabase/functions/_shared/domain/planner";
import { ADAPTER_REVISION } from "../../supabase/functions/_shared/domain/api";

const endpoint = "**/functions/v1/recovery";
function fixtureResponse(request: any, conversation?: any, assistance?: any) {
  const f = daytimeFixture();
  const checkedAt = new Date().toISOString();
  const candidates = request.mode === "synthetic" ? f.candidates : [];
  const result = planRecovery({ ...request, confirmedOptions: candidates }, candidates, { now: f.now });
  return { result, facts: { candidates, arrival: { arrivalAt: request.arrivalAt, arrivalBasis: request.arrivalBasis }, arrivalEvidence: request.mode === "synthetic" ? f.candidates[0].evidence : [{ type: "traveler_confirmed", provider: "Traveler", sourceUrl: null, checkedAt, serviceDate: request.arrivalAt.slice(0,10), providerUpdatedAt: null, expiresAt: null, environment: "production", warnings: [] }], hotelOffers: [], checkedAt, expiresAt: new Date(Date.now()+240_000).toISOString(), adapterRevision: ADAPTER_REVISION }, ...(conversation ? { conversation: { turnId: conversation.turnId, baseRevision: conversation.baseRevision } } : {}), ...(assistance ? { assistance } : {}) };
}
test("a short starter becomes one conversation and preserves unknown original connection and ASAP", async ({ page }) => {
  let input: any;
  await page.route(endpoint, async route => { input = route.request().postDataJSON(); await route.fulfill({ json: fixtureResponse(input.request) }); });
  await page.goto("/legacy");
  await expect(page.getByRole("heading", { name: "Let's get you to Portland" })).toBeVisible();
  await expect(page.getByLabel("Gate arrival", { exact:true })).toHaveValue("now");
  await expect(page.getByLabel("Arrival goal")).toHaveValue("asap");
  await expect(page.getByLabel("Original onward departure")).toHaveCount(0);
  await expect(page.getByLabel("Guest nationality (2-letter country code)")).toHaveCount(0);
  await page.getByRole("button", { name: "Find my options", exact: true }).click();
  await expect(page.getByRole("log", { name: "Recovery conversation" })).toContainText("BOS to Portland");
  expect(input.request.originalDepartureAt).toBeNull();
  expect(input.request.deadlineAt).toBeNull();
  expect(input.investigate).toBe(true);
  await expect(page.locator("summary").filter({hasText:/^Edit trip/})).toContainText("Earliest arrival");
  await expect(page.locator("summary").filter({hasText:/^Edit trip/})).toContainText("Overnight not allowed");
  await expect(page.getByRole("button", { name: "Cheaper", exact: true })).toBeVisible();
  await expect(page.getByLabel("Message about your trip")).toHaveAttribute("maxlength", "500");
});

test("typed factual clarification keeps current cards then a structured answer rebuilds the request", async ({ page }) => {
  const posts: any[] = [];
  await page.route(endpoint, async route => {
    const input = route.request().postDataJSON(); posts.push(input);
    const clarification = input.refinement ? { status: "limited", summary: "What is your updated Boston gate arrival?", appliedPreferences: {}, selectedPlanId: null, activity: [], clarification: { field: "arrivalAt", reason: "ambiguous" } } : undefined;
    const output = fixtureResponse(input.request, input.conversation, clarification);
    if (clarification) { output.result.plans = []; output.result.request.confirmedOptions = []; output.facts.candidates = []; }
    await route.fulfill({ json: output });
  });
  await page.goto("/legacy");
  await page.getByText("Try a demonstration", { exact:true }).click();
  await page.getByRole("button", { name:"Daytime fictional example", exact:true }).click();
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  await page.getByLabel("Message about your trip").fill("My flight is arriving later");
  await page.getByRole("button", { name:"Send message", exact:true }).click();
  const facts = page.getByRole("form", { name:"Confirm trip fact" });
  await expect(facts).toBeVisible();
  await expect(page.getByText("Earlier comparisons",{exact:true})).toHaveCount(0);
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  expect(posts[1].conversation.history.some((turn:any) => turn.content === "My flight is arriving later")).toBe(false);
  await facts.getByLabel("Revised gate arrival").fill("2026-11-18T08:10");
  await facts.getByRole("button", { name:"Use these facts" }).click();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2].request.arrivalAt).toBe("2026-11-18T08:10:00-05:00");
  expect(posts[2].investigate).toBe(true);
});

test("wrong conversation echoes never render the supplied assistant response", async ({ page }) => {
  await page.route(endpoint, async route => {
    const input = route.request().postDataJSON();
    const output = fixtureResponse(input.request, input.conversation, input.refinement ? { status:"completed", summary:"OBSOLETE ANSWER MUST NOT APPEAR", appliedPreferences:{}, selectedPlanId:null, activity:[] } : undefined);
    if (input.conversation) output.conversation = { turnId:"other-turn", baseRevision:input.conversation.baseRevision };
    await route.fulfill({ json:output });
  });
  await page.goto("/legacy");
  await page.getByText("Try a demonstration", { exact:true }).click();
  await page.getByRole("button", { name:"Daytime fictional example", exact:true }).click();
  await expect(page.getByTestId("option-card")).toHaveCount(3);
  await page.getByLabel("Message about your trip").fill("Can we simplify this?");
  await page.getByRole("button", { name:"Send message", exact:true }).click();
  await expect(page.getByRole("alert")).toContainText("earlier trip or message");
  await expect(page.getByRole("log")).not.toContainText("OBSOLETE ANSWER");
});

test("an explicitly chosen deadline must be entered before any source request", async ({ page }) => {
  let posts = 0;
  await page.route(endpoint, async route => { posts++; await route.abort(); });
  await page.goto("/legacy");
  await page.getByLabel("Arrival goal").selectOption("deadline");
  await page.getByRole("button", { name:"Find my options", exact:true }).click();
  await expect(page.getByRole("alert")).toContainText("Enter an arrival deadline");
  expect(posts).toBe(0);
});
test("confirming a typed stay clarification explicitly enables overnight and preserves exact stay facts", async ({ page }) => {
  const posts:any[] = [];
  await page.route(endpoint, async route => {
    const input = route.request().postDataJSON(); posts.push(input);
    const assistance = input.refinement ? { status:"limited", summary:"Which night should I check?", appliedPreferences:{}, selectedPlanId:null, activity:[], clarification:{ field:"stay", reason:"required" } } : undefined;
    await route.fulfill({ json:fixtureResponse(input.request,input.conversation,assistance) });
  });
  await page.goto("/legacy");
  await page.getByRole("button",{name:"Find my options",exact:true}).click();
  await expect(page.getByRole("button",{name:"Send message"})).toBeDisabled();
  await page.getByLabel("Message about your trip").fill("Can we stay overnight?");
  await page.getByRole("button",{name:"Send message"}).click();
  const facts=page.getByRole("form",{name:"Confirm trip fact"});
  await facts.getByLabel("Check-in date").fill("2026-11-18");
  await facts.getByLabel("Check-out date").fill("2026-11-19");
  await facts.getByLabel("Guest nationality (2-letter country code)").fill("US");
  await facts.getByRole("button",{name:"Use these facts"}).click();
  await expect.poll(()=>posts.length).toBe(3);
  expect(posts[2].request.overnightAllowed).toBe(true);
  expect(posts[2].request.stay).toMatchObject({checkin:"2026-11-18",checkout:"2026-11-19",guestNationality:"US"});
});

function hotelResponse(input:any) {
  const request = input.request;
  const checkedAt = new Date().toISOString(), expiresAt = new Date(Date.now()+180000).toISOString();
  const source = overnightFixture().candidates.find(option=>option.kind==="overnight")!;
  if(source.kind!=="overnight") throw new Error("Hotel fixture missing");
  const sandbox = request.hotelDataMode === "sandbox";
  const evidence = { type:sandbox?"estimated":"traveler_confirmed", environment:sandbox?"sandbox":"production", provider:sandbox?"Sandbox test rates":"Checked hotel test fixture", checkedAt, expiresAt, sourceUrl:null, serviceDate:request.stay?.checkin ?? request.arrivalAt.slice(0,10), providerUpdatedAt:null, warnings:["Test fixture; no live booking"] };
  const hotelOffers = request.stay ? [{...source.hotel,id:"guided-property",name:"Guided test property",checkin:request.stay.checkin,checkout:request.stay.checkout,quoteExpiresAt:expiresAt,evidence:[evidence]}] : [];
  const manual = request.confirmedOptions.filter((option:any)=>option.id==="manual-transit");
  const paired = buildHotelRecovery({...request,confirmedOptions:manual},hotelOffers as any,checkedAt);
  const candidates = [...manual,...paired.candidates];
  const result = planRecovery({...request,confirmedOptions:candidates},candidates,{now:checkedAt});
  return {result,facts:{candidates,hotelOffers,checkedAt,expiresAt,adapterRevision:ADAPTER_REVISION,arrival:{arrivalAt:request.arrivalAt,arrivalBasis:request.arrivalBasis},arrivalEvidence:[{...evidence,type:sandbox?"synthetic":"traveler_confirmed",environment:sandbox?"synthetic":"production"}]}};
}
test("a selected hotel asks focused facts and blocks invalid transfers and service dates without a source call", async ({ page }) => {
  const posts:any[]=[];
  await page.route(endpoint,async route=>{const input=route.request().postDataJSON();posts.push(input);await route.fulfill({json:hotelResponse(input)});});
  await page.goto("/legacy");
  await page.getByLabel("Gate arrival",{exact:true}).selectOption("custom");
  await page.getByLabel("Revised gate arrival").fill("2026-11-18T18:00");
  await page.getByRole("button",{name:"Find my options",exact:true}).click();
  await expect(page.getByRole("button",{name:"Explore overnight"})).toBeEnabled();
  await page.getByRole("button",{name:"Explore overnight"}).click();
  const facts=page.getByRole("form",{name:"Confirm trip fact"});
  await facts.getByRole("button",{name:"Use these facts"}).click();
  await expect(facts.getByRole("alert")).toContainText("Enter the stay dates");
  expect(posts).toHaveLength(1);
  await facts.getByLabel("Check-in date").fill("2026-11-18");
  await facts.getByLabel("Check-out date").fill("2026-11-19");
  await facts.getByLabel("Guest nationality (2-letter country code)").fill("US");
  await facts.getByRole("button",{name:"Use these facts"}).click();
  await page.getByRole("button",{name:"Use Guided test property",exact:true}).click();
  await expect(facts.getByLabel("Airport to hotel minutes")).toBeVisible();
  await facts.getByLabel("Airport to hotel minutes").fill("20");
  await facts.getByLabel("Airport to hotel cost (USD)").fill("-1");
  await facts.getByRole("button",{name:"Use this fact"}).click();
  await expect(facts.getByRole("alert")).toContainText("nonnegative USD amount");
  expect(posts).toHaveLength(2);
  await facts.getByLabel("Airport to hotel cost (USD)").fill("0");
  await facts.getByRole("button",{name:"Use this fact"}).click();
  await facts.getByLabel("Hotel check-in minutes").fill("1.5");
  await facts.getByLabel("Hotel check-in minutes").press("Enter");
  await expect(facts.getByLabel("Hotel check-in minutes")).toBeVisible();
  expect(posts).toHaveLength(2);
  await facts.getByLabel("Hotel check-in minutes").fill("15");
  await facts.getByRole("button",{name:"Use this fact"}).click();
  await facts.getByLabel("Leave hotel at").fill("2026-11-19T09:00");
  await facts.getByRole("button",{name:"Use this fact"}).click();
  await facts.getByLabel("Hotel to boarding stop minutes").fill("25");
  await facts.getByLabel("Hotel to boarding stop cost (USD)").fill("0");
  await facts.getByRole("button",{name:"Use this fact"}).click();
  for(const [label,value] of [["Operator / service name","Checked onward bus"],["Transit departure","2026-11-18T10:00"],["Transit arrival","2026-11-19T12:00"],["Departure terminal","Checked Boston stop"],["Arrival terminal","Checked Portland stop"],["Airport to boarding stop minutes","30"],["Final transfer minutes","15"],["Fare (USD)","35"],["Final transfer cost (USD)","0"]]) await facts.getByLabel(label,{exact:true}).fill(value);
  await facts.getByRole("button",{name:"Use this fact"}).click();
  await expect(facts.getByRole("alert")).toContainText("checkout date");
  expect(posts).toHaveLength(2);
  await facts.getByLabel("Transit departure",{exact:true}).fill("2026-11-19T10:00");
  await facts.getByRole("button",{name:"Use this fact"}).click();
  // The newly entered boarding stop needs a new property-specific transfer confirmation.
  await facts.getByLabel("Hotel to boarding stop minutes").fill("25");
  await facts.getByLabel("Hotel to boarding stop cost (USD)").fill("0");
  await facts.getByRole("button",{name:"Use this fact"}).click();
  await expect.poll(()=>posts.length).toBe(3);
  expect(posts[2].request.hotelSelection).toMatchObject({hotelId:"guided-property",stationAccess:{minutes:25,costCents:0}});
  expect(posts[2].request.confirmedOptions[0].departureAt).toBe("2026-11-19T10:00:00-05:00");
});
test("sandbox guide completes with explicit fictional defaults, saves and refreshes without model or booking calls", async ({ page }) => {
  const posts:any[]=[], otherCalls:string[]=[];
  page.on("request",request=>{if(["fetch","xhr"].includes(request.resourceType())&&!request.url().includes("/functions/v1/recovery"))otherCalls.push(request.url());});
  await page.route(endpoint,async route=>{const input=route.request().postDataJSON();posts.push(input);await route.fulfill({json:hotelResponse(input)});});
  await page.goto("/legacy");
  await page.getByText("Try a demonstration",{exact:true}).click();
  await page.getByRole("button",{name:"Try hotel sandbox",exact:true}).click();
  await page.getByRole("button",{name:"Use Guided test property",exact:true}).click();
  await page.getByLabel("Message about your trip").fill("What next?");
  await page.getByRole("button",{name:"Send message",exact:true}).click();
  await expect(page.getByRole("log")).toContainText("Demo guide (not a model)");
  expect(posts).toHaveLength(1);
  await page.getByRole("button",{name:"Use fictional transfer defaults",exact:true}).click();
  await expect.poll(()=>posts.length).toBe(2);
  expect(posts[1].request.hotelSelection).toMatchObject({checkinMinutes:15,hotelAccess:{minutes:20,costCents:0},stationAccess:{minutes:25,costCents:0}});
  const target=page.getByRole("button",{name:/View Guided test property/});
  if(!await target.isVisible())await page.getByText(/Other options/).click();
  await target.click();
  await page.getByRole("button",{name:"Save on this device",exact:true}).click();
  await expect(page.getByTestId("saved-plan")).toContainText("Sandbox / test itinerary");
  const stored=await page.evaluate(()=>localStorage.getItem("travel-recovery:selected:v1:account:11111111-1111-4111-8111-111111111111"));
  expect(stored).not.toContain("What next?");
  await page.reload();
  await expect(page.getByTestId("saved-plan")).toContainText("Historical snapshot");
  expect(posts).toHaveLength(2);
  await expect(page.getByTestId("saved-plan").locator('a[href^="http"]')).toHaveCount(0);
  await page.getByRole("button",{name:"Refresh this plan",exact:true}).click();
  await expect.poll(()=>posts.length).toBe(3);
  expect(posts[2].investigate).toBe(true);
  expect(otherCalls).toEqual([]);
});

test("typed replacement with the same plan ID requires a new selection and save, and archives previous cards", async ({ page }) => {
  const posts:any[]=[];
  await page.route(endpoint,async route=>{
    const input=route.request().postDataJSON(); posts.push(input);
    const output=fixtureResponse(input.request,input.conversation);
    if(input.refinement){
      const candidates=structuredClone(daytimeFixture().candidates);
      const bus=candidates.find(option=>option.id==="bus");
      if(!bus || bus.kind!=="bus")throw new Error("Missing bus fixture");
      bus.fareCents! += 1000;
      output.facts.candidates=candidates;
      output.result=planRecovery({...input.request,priority:"cheapest",confirmedOptions:candidates},candidates,{now:daytimeFixture().now});
      output.assistance={status:"completed",summary:"Cheapest priority applied to the newly checked prices.",appliedPreferences:{priority:"cheapest"},selectedPlanId:null,activity:[]};
    }
    await route.fulfill({json:output});
  });
  await page.goto("/legacy");
  await page.getByText("Try a demonstration",{exact:true}).click();
  await page.getByRole("button",{name:"Daytime fictional example",exact:true}).click();
  const target=page.getByRole("button",{name:"View Fictional intercity bus",exact:true});
  if(!await target.isVisible())await page.getByText(/^Other options/).click();
  await target.click();
  await page.getByRole("button",{name:"Save on this device",exact:true}).click();
  const original=await page.evaluate(()=>localStorage.getItem("travel-recovery:selected:v1:account:11111111-1111-4111-8111-111111111111"));
  expect(JSON.parse(original!).plan.knownCostCents).toBe(4700);
  await page.getByLabel("Message about your trip").fill("Prefer the cheapest newly checked option");
  await page.getByRole("button",{name:"Send message",exact:true}).click();
  await expect(page.getByTestId("option-card").first()).toContainText("$57.00");
  await expect(page.getByTestId("itinerary")).toContainText("No itinerary selected");
  await expect(page.getByRole("button",{name:"Save on this device",exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem("travel-recovery:selected:v1:account:11111111-1111-4111-8111-111111111111"))).toBe(original);
  await page.getByText("Earlier comparisons",{exact:true}).click();
  await expect(page.getByTestId("historical-option-card")).toHaveCount(3);
  await expect(page.getByTestId("historical-option-card").filter({hasText:"Fictional intercity bus"})).toContainText("$47.00");
  await expect(page.getByTestId("historical-option-card").getByRole("button")).toHaveCount(0);
  await target.click();
  await expect(page.getByTestId("itinerary")).toContainText("Not booked or saved");
  await page.getByRole("button",{name:"Save on this device",exact:true}).click();
  const replaced=await page.evaluate(()=>localStorage.getItem("travel-recovery:selected:v1:account:11111111-1111-4111-8111-111111111111"));
  expect(JSON.parse(replaced!).plan.knownCostCents).toBe(5700);
  expect(posts).toHaveLength(2);
});

for(const initialGoal of ["asap","deadline"] as const){
  test(`inline arrival goal confirmation syncs Edit trip from ${initialGoal} to ${initialGoal==="asap"?"deadline":"asap"}`,async({page})=>{
    const posts:any[]=[];
    await page.route(endpoint,async route=>{
      const input=route.request().postDataJSON();posts.push(input);
      const assistance=input.refinement?{status:"limited",summary:"Confirm your arrival goal.",appliedPreferences:{},selectedPlanId:null,activity:[],clarification:{field:"deadlineAt",reason:"ambiguous"}}:undefined;
      await route.fulfill({json:fixtureResponse(input.request,input.conversation,assistance)});
    });
    await page.goto("/legacy");
    await page.getByLabel("Gate arrival",{exact:true}).selectOption("custom");
    await page.getByLabel("Revised gate arrival").fill("2026-11-18T08:00");
    if(initialGoal==="deadline"){
      await page.getByLabel("Arrival goal").selectOption("deadline");
      await page.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
    }
    await page.getByRole("button",{name:"Find my options",exact:true}).click();
    await page.getByLabel("Message about your trip").fill("Change my arrival goal");
    await page.getByRole("button",{name:"Send message",exact:true}).click();
    const facts=page.getByRole("form",{name:"Confirm trip fact"});
    if(initialGoal==="asap")await facts.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
    else await facts.getByRole("button",{name:"Use as soon as possible",exact:true}).click();
    await facts.getByRole("button",{name:"Use these facts",exact:true}).click();
    await expect.poll(()=>posts.length).toBe(3);
    await expect(facts).toHaveCount(0);
    await page.locator("summary").filter({hasText:/^Edit trip/}).click();
    await expect(page.getByLabel("Arrival goal")).toHaveValue(initialGoal==="asap"?"deadline":"asap");
    await page.getByRole("button",{name:"Update options",exact:true}).click();
    await expect.poll(()=>posts.length).toBe(4);
    expect(posts[3].request.deadlineAt).toBe(initialGoal==="asap"?"2026-11-18T14:00:00-05:00":null);
  });
}

test("a confirmed inline deadline stays in Edit trip even if the following source request fails",async({page})=>{
  let posts=0;
  await page.route(endpoint,async route=>{
    const input=route.request().postDataJSON();posts++;
    if(posts===3){await route.fulfill({status:503,json:{error:"Unavailable test source"}});return;}
    const assistance=input.refinement?{status:"limited",summary:"Confirm the deadline.",appliedPreferences:{},selectedPlanId:null,activity:[],clarification:{field:"deadlineAt",reason:"ambiguous"}}:undefined;
    await route.fulfill({json:fixtureResponse(input.request,input.conversation,assistance)});
  });
  await page.goto("/legacy");
  await page.getByLabel("Gate arrival",{exact:true}).selectOption("custom");
  await page.getByLabel("Revised gate arrival").fill("2026-11-18T08:00");
  await page.getByRole("button",{name:"Find my options",exact:true}).click();
  await page.getByLabel("Message about your trip").fill("I need to set an arrival deadline");
  await page.getByRole("button",{name:"Send message",exact:true}).click();
  const facts=page.getByRole("form",{name:"Confirm trip fact"});
  await facts.getByLabel("Final destination deadline").fill("2026-11-18T14:00");
  await facts.getByRole("button",{name:"Use these facts",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("planner is unavailable");
  await page.locator("summary").filter({hasText:/^Edit trip/}).click();
  await expect(page.getByLabel("Arrival goal")).toHaveValue("deadline");
  await expect(page.getByLabel("Final destination deadline")).toHaveValue("2026-11-18T14:00");
  expect(posts).toBe(3);
});
