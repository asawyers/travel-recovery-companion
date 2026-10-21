import {describe,expect,it,vi} from 'vitest'
import {overnightFixture} from '../../supabase/functions/_shared/domain/fixtures.ts'
import {TripRequestSchema} from '../../supabase/functions/_shared/domain/schemas.ts'
import type {HotelOption,TripRequest} from '../../supabase/functions/_shared/domain/schemas.ts'
import {RecoveryResponseSchema} from '../../supabase/functions/_shared/domain/api.ts'
import {createRecoveryHandler} from '../../supabase/functions/_shared/server/handlers.ts'
const f=overnightFixture()
function demo():TripRequest{
 const overnight=f.candidates[0];if(overnight.kind!=='overnight')throw Error('fixture')
 return {...f.request,hotelDataMode:'sandbox',confirmedOptions:[overnight.nextDayTransit],hotelSelection:{hotelId:overnight.hotel.id,nextDayTransitId:overnight.nextDayTransit.id,checkinMinutes:15,leaveHotelAt:overnight.leaveHotelAt,hotelAccess:{minutes:20,costCents:2000,kind:'transfer',checkedAt:f.now},stationAccess:{minutes:25,costCents:1500,kind:'transfer',checkedAt:f.now}}} as TripRequest
}
function offer():HotelOption{
 const overnight=f.candidates[0];if(overnight.kind!=='overnight')throw Error('fixture')
 const hotel=structuredClone(overnight.hotel)
 hotel.evidence=hotel.evidence.map(e=>({...e,type:'estimated',environment:'sandbox',provider:'Nuitee LiteAPI sandbox (test data)'}))
 return hotel
}
const post=(request:TripRequest,investigate=true,refinement?:string)=>new Request('http://localhost/recovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request,investigate,...(refinement?{refinement}:{})})})
function setup(hotel=offer()){
 const findTransport=vi.fn(async()=>({candidates:[],warnings:['must not run']}))
 const findHotels=vi.fn(async()=>({candidates:[],offers:[hotel],warnings:['Sandbox test quotes; no live availability.']}))
 const createSession=vi.fn(()=>({findTransport,findHotels}))
 const gatherPermittedFacts=vi.fn(async()=>({candidates:[],warnings:[]}))
 const agent=vi.fn(async()=>{throw Error('must not run')})
 const run=createRecoveryHandler({now:()=>f.now,providers:{createSession,gatherPermittedFacts},agent,hotelBookingOrigin:'https://assigned.nuitee.link'})
 return {run,findTransport,findHotels,createSession,agent,gatherPermittedFacts}
}
describe('explicit hotel sandbox request isolation',()=>{
 it('accepts the marker only for synthetic trips',()=>{
  expect(TripRequestSchema.safeParse(demo()).success).toBe(true)
  expect(TripRequestSchema.safeParse({...demo(),mode:'real',confirmedOptions:[]}).success).toBe(false)
 })
 it('fetches only sandbox hotels, preserves test provenance and assesses a complete fictional journey',async()=>{
  const {run,findTransport,findHotels,createSession,agent}=setup()
  const response=await run(post(demo(),true,'Prefer cheapest'))
  expect(response.status).toBe(200)
  const body=RecoveryResponseSchema.parse(await response.json())
  expect(findHotels).toHaveBeenCalledTimes(1);expect(findTransport).not.toHaveBeenCalled();expect(agent).not.toHaveBeenCalled()
  expect(createSession.mock.calls[0][1]).toMatchObject({hotelSandbox:true})
  expect(body.facts.hotelOffers?.[0].evidence[0]).toMatchObject({type:'estimated',environment:'sandbox',provider:expect.stringContaining('sandbox')})
  expect(body.result.plans.find(plan=>plan.hotel?.id===offer().id)?.hotel?.evidence[0].environment).toBe('sandbox')
  expect(body.facts).not.toHaveProperty('hotelBookingOrigin')
  expect(body.result.request.mode).toBe('synthetic')
  expect(body.result.request.hotelDataMode).toBe('sandbox')
  expect(body.result.warnings.join(' ')).toMatch(/sandbox|test data/i)
  expect(body.assistance?.status).toBe('unavailable')
 })
 it('never fetches sandbox rates without explicit investigation',async()=>{
  const {run,findHotels,findTransport}=setup()
  expect((await run(post(demo(),false))).status).toBe(200)
  expect(findHotels).not.toHaveBeenCalled();expect(findTransport).not.toHaveBeenCalled()
 })
 it('keeps ordinary synthetic examples offline',async()=>{
  const {run,findHotels,findTransport,gatherPermittedFacts}=setup()
  expect((await run(post(f.request))).status).toBe(200)
  expect(findHotels).not.toHaveBeenCalled();expect(findTransport).not.toHaveBeenCalled();expect(gatherPermittedFacts).not.toHaveBeenCalled()
 })
 it('rejects production evidence returned by a sandbox provider',async()=>{
  const hotel=offer();hotel.evidence[0]={...hotel.evidence[0],type:'live',environment:'production'}
  const body=RecoveryResponseSchema.parse(await(await setup(hotel).run(post(demo()))).json())
  expect(body.facts.hotelOffers??[]).toEqual([])
  expect(body.result.warnings.join(' ')).toMatch(/unavailable/i)
 })
 it('does not preserve browser claims of having checked a sandbox provider',async()=>{
  const request=demo();const overnight=structuredClone(f.candidates[0]);if(overnight.kind!=='overnight')throw Error('fixture')
  overnight.hotel=offer();request.confirmedOptions.push(overnight)
  const body=RecoveryResponseSchema.parse(await(await setup().run(post(request,false))).json())
  const normalized=body.facts.candidates.find(c=>c.kind==='overnight')
  if(normalized?.kind!=='overnight')throw Error('missing historical input')
  expect(normalized.hotel.evidence[0]).toMatchObject({type:'synthetic',environment:'synthetic',provider:'Fictional traveler input'})
 })
})
