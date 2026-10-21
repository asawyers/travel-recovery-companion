import {describe,expect,it,vi} from 'vitest'
const routes=vi.fn(()=>async()=>({status:'unavailable',reason:'Disabled',retryable:false}))
const hotels=vi.fn(()=>async()=>({status:'unavailable',reason:'Disabled',retryable:false}))
const agent=vi.fn(()=>async()=>({status:'unavailable',summary:'Disabled',appliedPreferences:{},selectedPlanId:null,activity:[]}))
vi.mock('../../supabase/functions/_shared/server/google-routes.ts',()=>({createGoogleRoutesAdapter:routes}))
vi.mock('../../supabase/functions/_shared/server/liteapi.ts',()=>({createLiteApiAdapter:hotels}))
vi.mock('../../supabase/functions/_shared/server/recovery-agent.ts',()=>({createRecoveryAgent:agent}))
const keys={GOOGLE_ROUTES_API_KEY:'routes-test',LITEAPI_KEY:'hotels-test',OPENAI_API_KEY:'model-test',OPENAI_MODEL:'explicit-test-model'}
async function load(values:Record<string,string|undefined>){
 vi.resetModules()
 const get=vi.fn((name:string)=>values[name]);vi.stubGlobal('Deno',{env:{get},serve:vi.fn()})
 await import('../../supabase/functions/recovery/index.ts')
 return get.mock.calls.flat()
}
describe('independent provider and model activation',()=>{
 it('keeps all paid providers disabled and does not read keys by default',async()=>{
  try{
   const reads=await load(keys)
   expect(routes.mock.lastCall?.[0]).toMatchObject({enabled:false})
   expect(hotels.mock.lastCall?.[0]).toMatchObject({enabled:false})
   expect(agent.mock.lastCall?.[0]).toMatchObject({enabled:false})
   expect(reads).not.toContain('GOOGLE_ROUTES_API_KEY');expect(reads).not.toContain('LITEAPI_KEY');expect(reads).not.toContain('OPENAI_API_KEY')
  }finally{vi.unstubAllGlobals()}
 })
 it('does not let Google usage approval authorize hotel or model calls',async()=>{
  try{await load({...keys,RECOVERY_PROVIDER_USAGE_APPROVED:'true'});expect(routes.mock.lastCall?.[0]).toMatchObject({enabled:true});expect(hotels.mock.lastCall?.[0]).toMatchObject({enabled:false});expect(agent.mock.lastCall?.[0]).toMatchObject({enabled:false})}finally{vi.unstubAllGlobals()}
 })
 it('uses the registered recovery model without reading an environment model override',async()=>{
  try{
   const reads=await load({...keys,RECOVERY_MODEL_USAGE_APPROVED:'true',OPENAI_MODEL:'unexpected-environment-model'})
   expect(agent.mock.lastCall?.[0]).toMatchObject({enabled:true,modelName:'gpt-6-luna'})
   expect(reads).not.toContain('OPENAI_MODEL')
  }finally{vi.unstubAllGlobals()}
 })
 it('requires independent hotel public-rate/environment and model configuration',async()=>{
  try{
   await load({...keys,RECOVERY_HOTEL_USAGE_APPROVED:'true',RECOVERY_MODEL_USAGE_APPROVED:'true'})
   expect(hotels.mock.lastCall?.[0]).toMatchObject({enabled:false})
   expect(agent.mock.lastCall?.[0]).toMatchObject({enabled:true,modelName:'gpt-6-luna'})
   await load({...keys,RECOVERY_HOTEL_USAGE_APPROVED:'true',RECOVERY_HOTEL_PUBLIC_RATES_APPROVED:'true',LITEAPI_ENVIRONMENT:'production',RECOVERY_MODEL_USAGE_APPROVED:'true',OPENAI_API_KEY:undefined})
   expect(hotels.mock.lastCall?.[0]).toMatchObject({enabled:true,environment:'production',publicRatesApproved:true})
   expect(agent.mock.lastCall?.[0]).toMatchObject({enabled:false})
  }finally{vi.unstubAllGlobals()}
 })
})
