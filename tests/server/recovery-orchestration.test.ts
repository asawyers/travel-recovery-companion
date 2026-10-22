import { describe, expect, it, vi } from 'vitest'
import { Usage } from '@openai/agents'
import type { Model, ModelResponse } from '@openai/agents'
import { createRecoveryAgent } from '../../supabase/functions/_shared/server/recovery-agent.ts'
import { createRecoveryHandler } from '../../supabase/functions/_shared/server/handlers.ts'
import { createProviderRegistry } from '../../supabase/functions/_shared/server/providers.ts'
import type { AgentExecutor } from '../../supabase/functions/_shared/server/agent-contracts.ts'
import { daytimeFixture, overnightFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import { RecoveryResponseSchema } from '../../supabase/functions/_shared/domain/api.ts'
import type { TripRequest } from '../../supabase/functions/_shared/domain/schemas.ts'
const now = daytimeFixture().now
const real = (r: TripRequest): TripRequest => JSON.parse(JSON.stringify({...r,mode:'real'}).replaceAll('"synthetic"','"production"').replaceAll('"type":"production"','"type":"traveler_confirmed"'))
const post = (request:TripRequest, investigate=false, refinement?:string) => new Request('http://localhost/recovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request,investigate,...(refinement?{refinement}:{})})})
const emptyProviders = () => createProviderRegistry({})
const unavailable = {status:'unavailable' as const,summary:'Assistance unavailable; edit the trip fields.',appliedPreferences:{},selectedPlanId:null,activity:[]}
describe('recovery request orchestration',()=>{
 it('executes the actual SDK runner through handler discovery and assessed preference selection',async()=>{
  const request=real(daytimeFixture().request)
  const candidate=request.confirmedOptions.find(c=>c.kind==='bus')!
  request.confirmedOptions=[]
  const routes=vi.fn(async()=>({status:'ok' as const,data:{candidates:[candidate]},evidence:candidate.evidence,warnings:[]}))
  let callId=0
  const call=(name:string,args:unknown={})=>({type:'function_call' as const,name,arguments:JSON.stringify(args),callId:`tool-${++callId}`})
  const outputs:ModelResponse['output'][]=[
    [call('find_transport_options')],[call('find_transport_options')],
    [call('assess_recovery_options',{preferencePatch:{drivingAllowed:false,priority:'cheapest'}})],
    [{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({assessmentId:'assessment-1',planId:candidate.id,reasonCodes:['no_driving','lowest_complete_price'],unsupportedRequest:false,clarification:null})}]}],
  ]
  const model:Model={getResponse:async()=>({usage:new Usage(),output:outputs.shift()!}),async *getStreamedResponse(){throw Error('No streaming')}}
  const agent=createRecoveryAgent({enabled:true,now:()=>now,model})
  const body=RecoveryResponseSchema.parse(await(await createRecoveryHandler({now:()=>now,providers:createProviderRegistry({routes}),agent})(post(request,true,'No driving and prefer cheapest'))).json())
  expect(body.assistance).toMatchObject({status:'completed',selectedPlanId:candidate.id,appliedPreferences:{drivingAllowed:false,priority:'cheapest'}})
  expect(body.result.plans).toHaveLength(1)
  expect(body.facts.candidates[0].id).toBe(candidate.id)
  expect(routes).toHaveBeenCalledTimes(1)
  expect(body.assistance?.activity.filter(a=>a.tool==='find_transport_options'&&a.status==='completed')).toHaveLength(2)
 })
 it('applies only an assessed preference patch and keeps canonical facts consistent',async()=>{
  const agent:AgentExecutor=async({tools})=>{await tools.findTransport();const a=await tools.assess({drivingAllowed:false});return{...unavailable,status:'completed',summary:'Compared confirmed options without driving.',appliedPreferences:{drivingAllowed:false},selectedPlanId:a.result.plans[0].id}}
  const run=createRecoveryHandler({now:()=>now,providers:emptyProviders(),agent})
  const response=await run(post(real(daytimeFixture().request),false,'No driving please'))
  expect(response.status).toBe(200)
  const body=RecoveryResponseSchema.parse(await response.json())
  expect(body.result.request.drivingAllowed).toBe(false)
  expect(body.result.plans.every(p=>p.legs.every(l=>l.kind!=='car'))).toBe(true)
  expect(body.assistance?.status).toBe('completed')
 })
 it('never runs the model for synthetic trips or absent refinements',async()=>{
  const agent=vi.fn<AgentExecutor>(async()=>unavailable)
  const run=createRecoveryHandler({now:()=>now,providers:emptyProviders(),agent})
  expect((await run(post(daytimeFixture().request,true,'No driving'))).status).toBe(200)
  expect((await run(post(real(daytimeFixture().request)))).status).toBe(200)
  expect(agent).not.toHaveBeenCalled()
 })
 it('does not let agent discovery bypass explicit provider investigation consent',async()=>{
  const gatherPermittedFacts=vi.fn(async()=>({candidates:[],warnings:[]}))
  const agent:AgentExecutor=async({tools})=>{await tools.findTransport();await tools.findHotels();return unavailable}
  const response=await createRecoveryHandler({now:()=>now,providers:{gatherPermittedFacts},agent})(post(real(daytimeFixture().request),false,'Find alternatives'))
  expect(response.status).toBe(200);expect(gatherPermittedFacts).not.toHaveBeenCalled()
 })
 it('falls back to original preferences after an incomplete agent run',async()=>{
  const agent:AgentExecutor=async({tools})=>{await tools.assess({drivingAllowed:false});return{...unavailable,status:'limited'}}
  const body=RecoveryResponseSchema.parse(await(await createRecoveryHandler({now:()=>now,providers:emptyProviders(),agent})(post(real(daytimeFixture().request),false,'No driving'))).json())
  expect(body.result.request.drivingAllowed).toBe(true)
  expect(body.assistance?.appliedPreferences).toEqual({})
 })
 it('retains explicit provider investigation when the model is not configured',async()=>{
  const gatherPermittedFacts=vi.fn(async()=>({candidates:[],warnings:[]}))
  const response=await createRecoveryHandler({now:()=>now,providers:{gatherPermittedFacts}})(post(real(daytimeFixture().request),true,'Cheapest please'))
  const body=RecoveryResponseSchema.parse(await response.json())
  expect(gatherPermittedFacts).toHaveBeenCalledTimes(1)
  expect(body.assistance?.status).toBe('unavailable')
  expect(body.result.plans.length).toBeGreaterThan(0)
 })
 it('returns hotel offers separately and caps facts by offer freshness',async()=>{
  const request=real(overnightFixture().request)
  const overnight=request.confirmedOptions[0];if(overnight.kind!=='overnight')throw Error('fixture')
  const hotel=structuredClone(overnight.hotel);hotel.evidence[0].expiresAt=new Date(Date.parse(now)+60000).toISOString()
  const body=RecoveryResponseSchema.parse(await(await createRecoveryHandler({now:()=>now,providers:{gatherPermittedFacts:async()=>({candidates:[],offers:[hotel],warnings:[]})},hotelBookingOrigin:'https://assigned.nuitee.link'})(post(request,true))).json())
  expect(body.facts.hotelOffers).toHaveLength(1)
  expect(body.facts.expiresAt).toBe(hotel.evidence[0].expiresAt)
  expect(body.facts.hotelBookingOrigin).toBe('https://assigned.nuitee.link')
 })
 it('assesses newly collected hotel facts at current time without rewriting source timestamps',async()=>{
  const request=real(overnightFixture().request)
  const overnight=request.confirmedOptions[0];if(overnight.kind!=='overnight')throw Error('fixture')
  request.confirmedOptions=[overnight.nextDayTransit]
  request.hotelSelection={hotelId:overnight.hotel.id,nextDayTransitId:overnight.nextDayTransit.id,checkinMinutes:15,leaveHotelAt:overnight.leaveHotelAt,hotelAccess:{minutes:20,costCents:2000,kind:'transfer',checkedAt:now},stationAccess:{minutes:25,costCents:1500,kind:'transfer',checkedAt:now}}
  const collectedAt=new Date(Date.parse(now)+1000).toISOString()
  const assessedAt=new Date(Date.parse(now)+2000).toISOString()
  const hotel=structuredClone(overnight.hotel);hotel.evidence[0].checkedAt=collectedAt
  let clockReads=0
  const run=createRecoveryHandler({now:()=>clockReads++===0?now:assessedAt,providers:{gatherPermittedFacts:async()=>({candidates:[],offers:[hotel],warnings:[]})}})
  const body=RecoveryResponseSchema.parse(await(await run(post(request,true))).json())
  expect(body.result.plans.some(plan=>plan.hotel?.id===hotel.id)).toBe(true)
  expect(body.facts.hotelOffers?.[0].evidence[0].checkedAt).toBe(collectedAt)
 })
 it('retains the selected hotel journey at the twelve-candidate comparison limit',async()=>{
  const request=real(overnightFixture().request)
  const overnight=request.confirmedOptions[0];if(overnight.kind!=='overnight')throw Error('fixture')
  request.confirmedOptions=Array.from({length:12},(_,i)=>({...overnight.nextDayTransit,id:`transit-${i}`}))
  request.hotelSelection={hotelId:overnight.hotel.id,nextDayTransitId:'transit-0',checkinMinutes:15,leaveHotelAt:overnight.leaveHotelAt,hotelAccess:{minutes:20,costCents:2000,kind:'transfer',checkedAt:now},stationAccess:{minutes:25,costCents:1500,kind:'transfer',checkedAt:now}}
  const body=RecoveryResponseSchema.parse(await(await createRecoveryHandler({now:()=>now,providers:{gatherPermittedFacts:async()=>({candidates:[],offers:[overnight.hotel],warnings:[]})}})(post(request,true))).json())
  expect(body.result.plans.some(plan=>plan.hotel?.id===overnight.hotel.id)).toBe(true)
  expect(body.facts.candidates).toHaveLength(12)
  expect(body.result.warnings.join(' ')).toMatch(/12|twelve/)
 })
 it('refreshes a saved derived hotel candidate without retaining its stale quote or mutating history',async()=>{
  const request=real(overnightFixture().request)
  const original=request.confirmedOptions[0];if(original.kind!=='overnight')throw Error('fixture')
  const hotel=structuredClone(original.hotel);hotel.room='Refreshed provider room'
  original.id=`hotel-${hotel.id}-${original.nextDayTransit.id}`
  original.hotel.quoteExpiresAt=new Date(Date.parse(now)-1000).toISOString()
  request.confirmedOptions=[original.nextDayTransit,original]
  request.hotelSelection={hotelId:hotel.id,nextDayTransitId:original.nextDayTransit.id,checkinMinutes:15,leaveHotelAt:original.leaveHotelAt,hotelAccess:{minutes:20,costCents:2000,kind:'transfer',checkedAt:now},stationAccess:{minutes:25,costCents:1500,kind:'transfer',checkedAt:now}}
  const history=structuredClone(request)
  const body=RecoveryResponseSchema.parse(await(await createRecoveryHandler({now:()=>now,providers:{gatherPermittedFacts:async()=>({candidates:[],offers:[hotel],warnings:[]})}})(post(request,true))).json())
  expect(body.result.plans.find(plan=>plan.hotel?.id===hotel.id)?.hotel?.room).toBe('Refreshed provider room')
  expect(request).toEqual(history)
 })
 it('bounds a model that ignores cancellation and discards late preference writes',async()=>{
  vi.useFakeTimers()
  try{
   let finish!:()=>void
   const agent:AgentExecutor=async({tools})=>{await new Promise<void>(r=>{finish=r});await tools.assess({drivingAllowed:false});return unavailable}
   const pending=createRecoveryHandler({now:()=>now,providers:emptyProviders(),agent})(post(real(daytimeFixture().request),false,'No driving'))
   await vi.advanceTimersByTimeAsync(30001)
   const response=await pending;expect(response.status).toBe(200)
   const body=RecoveryResponseSchema.parse(await response.json());expect(body.result.request.drivingAllowed).toBe(true);expect(body.assistance?.status).toBe('limited')
   finish();await vi.advanceTimersByTimeAsync(1)
   expect(body.result.request.drivingAllowed).toBe(true)
  }finally{vi.useRealTimers()}
 })
})
