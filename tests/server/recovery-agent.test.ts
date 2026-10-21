import { describe, expect, it, vi } from 'vitest'
import { Usage } from '@openai/agents'
import type { Model, ModelRequest, ModelResponse } from '@openai/agents'
import { daytimeFixture } from '../../supabase/functions/_shared/domain/fixtures.ts'
import { planRecovery } from '../../supabase/functions/_shared/domain/planner.ts'
import type { PreferencePatch } from '../../supabase/functions/_shared/domain/assistance.ts'
import { createRecoveryAgent } from '../../supabase/functions/_shared/server/recovery-agent.ts'
import type { AgentTools } from '../../supabase/functions/_shared/server/agent-contracts.ts'

const fixture = daytimeFixture()
const now = () => fixture.now
const request = JSON.parse(JSON.stringify(fixture.request).replaceAll('"synthetic"', '"production"').replaceAll('"type":"production"', '"type":"traveler_confirmed"'))
request.mode = 'real'
let nextCall = 0
const call = (name: string, args: unknown = {}, id = `call-${++nextCall}`) => ({ type: 'function_call' as const, name, arguments: JSON.stringify(args), callId: id })
const final = (value: unknown) => ({ type: 'message' as const, role: 'assistant' as const, status: 'completed' as const, content: [{ type: 'output_text' as const, text: JSON.stringify(value) }] })
const decision = (extra = {}) => ({ assessmentId: 'assessment-1', planId: 'bus', reasonCodes: [], unsupportedRequest: false, ...extra })
function scripted(outputs: ModelResponse['output'][]): Model & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = []
  return { requests, getResponse: async input => { requests.push(input); return { usage: new Usage(), output: outputs.shift() ?? [final(decision())] } }, async *getStreamedResponse() { throw new Error('Streaming forbidden') } }
}
function setup(outputs: ModelResponse['output'][], changes: Partial<AgentTools> = {}) {
  const model = scripted(outputs)
  const tools: AgentTools = { findTransport: vi.fn(async () => ({ candidates: request.confirmedOptions, warnings: [] })), findHotels: vi.fn(async () => ({ candidates: [], offers: [], warnings: [] })), assess: vi.fn(async (patch: PreferencePatch) => ({ assessmentId: 'assessment-1', result: planRecovery({ ...request, ...patch }, request.confirmedOptions, { now: now() }) })), ...changes }
  const execute = createRecoveryAgent({ enabled: true, now, model })
  const run = (signal = new AbortController().signal) => execute({ request, refinement: 'Find a good option', tools, signal })
  return { model, tools, run }
}

describe('OpenAI Agents SDK recovery orchestration', () => {
  it('executes discovery, assessment and structured selection through the actual Runner', async () => {
    const { run, tools, model } = setup([[call('find_transport_options')], [call('assess_recovery_options', { preferencePatch: null })], [final(decision())]])
    const result = await run()
    expect(result.status).toBe('completed')
    expect(result.selectedPlanId).toBe('bus')
    expect(tools.findTransport).toHaveBeenCalledTimes(1)
    expect(tools.assess).toHaveBeenCalledWith({})
    expect(result.summary).toContain('arrival')
    expect(model.requests[0].tools.map(t => t.name)).toEqual(['find_transport_options', 'find_hotel_options', 'assess_recovery_options'])
    expect(model.requests[0].modelSettings).toMatchObject({ store: false, parallelToolCalls: false, retry: { maxRetries: 0 } })
    expect(model.requests[0].tracing).toBe(false)
  })
  it('applies only the assessed preference patch', async () => {
    const { run } = setup([[call('assess_recovery_options', { preferencePatch: { drivingAllowed: false, priority: 'cheapest' } })], [final(decision({ reasonCodes: ['no_driving', 'lowest_complete_price'] }))]])
    expect(await run()).toMatchObject({ status: 'completed', appliedPreferences: { drivingAllowed: false, priority: 'cheapest' } })
  })
  it.each(['unassessed', 'foreign', 'false reason', 'stale'])('rejects %s selections without adopting preferences', async kind => {
    const outputs: ModelResponse['output'][] = kind === 'unassessed' ? [] : [[call('assess_recovery_options', { preferencePatch: null })]]
    if (kind === 'stale') outputs.push([call('find_transport_options')])
    const value = decision(kind === 'foreign' ? { planId: 'invented' } : kind === 'false reason' ? { reasonCodes: ['no_feasible_plan'] } : {})
    outputs.push([final(value)], [final(value)])
    const { run } = setup(outputs)
    expect(await run()).toMatchObject({ status: 'limited', appliedPreferences: {}, selectedPlanId: null })
  })
  it('returns safe field-edit guidance for unsupported requests', async () => {
    const { run } = setup([[final(decision({ unsupportedRequest: true }))]])
    expect(await run()).toMatchObject({ status: 'limited', appliedPreferences: {}, selectedPlanId: null, summary: expect.stringContaining('edit') })
  })
  it('repairs one malformed tool call within the same global bounds', async () => {
    const { run, tools } = setup([[call('assess_recovery_options', { destination: 'elsewhere' })], [call('assess_recovery_options', { preferencePatch: null })], [final(decision())]])
    expect((await run()).status).toBe('completed')
    expect(tools.assess).toHaveBeenCalledTimes(1)
  })
  it('stops after the second malformed tool call', async () => {
    const { run, model, tools } = setup([[call('find_transport_options', { dates: 'invented' })], [call('find_transport_options', { destination: 'elsewhere' })]])
    expect((await run()).status).toBe('limited')
    expect(model.requests).toHaveLength(2)
    expect(tools.findTransport).not.toHaveBeenCalled()
  })
  it('caps all attempted tools before any oversized batch executes', async () => {
    const { run, tools } = setup([Array.from({ length: 13 }, (_, i) => call('find_transport_options', {}, String(i)))])
    expect((await run()).status).toBe('limited')
    expect(tools.findTransport).not.toHaveBeenCalled()
  })
  it('caps model turns at six even when repair was used', async () => {
    const { run, model } = setup([[call('find_transport_options', { invalid: true })], ...Array.from({ length: 8 }, () => [call('find_transport_options')])])
    expect((await run()).status).toBe('limited')
    expect(model.requests).toHaveLength(6)
  })
  it('races an abort-ignoring provider and does not append late completion', async () => {
    let resolve!: (value: { candidates: []; warnings: [] }) => void
    const { run, model } = setup([[call('find_transport_options')]], { findTransport: () => new Promise(done => { resolve = done }) })
    const controller = new AbortController()
    const pending = run(controller.signal)
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    controller.abort()
    const result = await pending
    expect(result.status).toBe('limited')
    const snapshot = JSON.stringify(result)
    resolve({ candidates: [], warnings: [] })
    await new Promise(done => setTimeout(done, 5))
    expect(JSON.stringify(result)).toBe(snapshot)
    expect(model.requests).toHaveLength(1)
  })
  it('never exposes raw provider errors or malformed facts to the model', async () => {
    const { run, model } = setup([[call('find_transport_options')], [call('assess_recovery_options', { preferencePatch: null })], [final(decision())]], { findTransport: async () => ({ candidates: [{ raw: 'PRIVATE_TOKEN' }], warnings: ['PRIVATE_TOKEN'] }) as never })
    await run()
    expect(JSON.stringify(model.requests)).not.toContain('PRIVATE_TOKEN')
  })
  it('omits identity, nationality, flight and raw evidence text from model context', async () => {
    const { model, tools } = setup([[call('assess_recovery_options', { preferencePatch: null })], [final(decision())]])
    await createRecoveryAgent({ enabled: true, now, model })({ request: { ...request, stay: { checkin: '2026-11-18', checkout: '2026-11-19', adults: 1, rooms: 1, guestNationality: 'ZZ' }, flight: { ident: 'PRIVATE_FLIGHT', departureDate: '2026-11-18' } }, tools, refinement: 'Find the cheapest option', signal: new AbortController().signal })
    expect(JSON.stringify(model.requests)).not.toContain('guestNationality')
    expect(JSON.stringify(model.requests)).not.toContain('PRIVATE_FLIGHT')
    expect(JSON.stringify(model.requests)).not.toContain('Synthetic transfer')
  })
  it.each([
    ['earliest_arrival', 'train'], ['lowest_complete_price', 'car'],
    ['fewest_transfers', 'train'], ['no_driving', 'car'],
    ['incomplete_price', 'bus'], ['confirmation_required', 'bus'],
  ])('rejects a false %s reason for %s', async (reason, planId) => {
    const choice = decision({ planId, reasonCodes: [reason] })
    const { run } = setup([[call('assess_recovery_options', { preferencePatch: null })], [final(choice)], [final(choice)]])
    expect((await run()).status).toBe('limited')
  })
  it('does not accept malformed assessments or expose their contents', async () => {
    const { run, model } = setup([[call('assess_recovery_options', { preferencePatch: null })], [final(decision())], [final(decision())]], { assess: async () => ({ assessmentId: 'assessment-1', result: { private: 'SECRET_PROVIDER_MESSAGE' } }) as never })
    expect((await run()).status).toBe('limited')
    expect(JSON.stringify(model.requests)).not.toContain('SECRET_PROVIDER_MESSAGE')
  })
  it('repairs malformed final JSON once and keeps the latest assessment', async () => {
    const { run, model, tools } = setup([[call('assess_recovery_options', { preferencePatch: null })], [final('not an object')], [final(decision())]])
    expect((await run()).status).toBe('completed')
    expect(model.requests).toHaveLength(3)
    expect(tools.assess).toHaveBeenCalledTimes(1)
  })
  it('rejects a null selection while an eligible plan exists', async () => {
    const { run } = setup([[call('assess_recovery_options', { preferencePatch: null })], [final(decision({ planId: null }))], [final(decision({ planId: null }))]])
    expect((await run()).status).toBe('limited')
  })
  it('accepts no-plan conclusions only after an empty deterministic assessment', async () => {
    const { run } = setup([[call('assess_recovery_options', { preferencePatch: null })], [final(decision({ planId: null, reasonCodes: ['no_feasible_plan'] }))]], { assess: async () => ({ assessmentId: 'assessment-1', result: planRecovery(request, [], { now: now() }) }) })
    expect(await run()).toMatchObject({ status: 'completed', selectedPlanId: null, summary: expect.stringContaining('No feasible') })
  })
  it('serializes callbacks even if a model returns multiple parallel calls', async () => {
    let active = 0
    let peak = 0
    const discovery = async () => { active++; peak = Math.max(peak, active); await new Promise(done => setTimeout(done, 3)); active--; return { candidates: [], warnings: [] } }
    const { run } = setup([[call('find_transport_options'), call('find_hotel_options'), call('assess_recovery_options', { preferencePatch: null })], [final(decision())]], { findTransport: discovery, findHotels: discovery })
    expect((await run()).status).toBe('completed')
    expect(peak).toBe(1)
  })
  it('bounds the request even when the model ignores cancellation', async () => {
    const { tools } = setup([])
    let resolve!: (response: ModelResponse) => void
    const getResponse = vi.fn(() => new Promise<ModelResponse>(done => { resolve = done }))
    const model: Model = { getResponse, async *getStreamedResponse() { throw new Error() } }
    const controller = new AbortController()
    const pending = createRecoveryAgent({ enabled: true, now, model })({ request, refinement: 'Help', tools, signal: controller.signal })
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    controller.abort()
    const result = await pending
    expect(result.status).toBe('limited')
    resolve({ usage: new Usage(), output: [call('find_transport_options')] })
    await new Promise(done => setTimeout(done, 5))
    expect(tools.findTransport).not.toHaveBeenCalled()
    expect(getResponse).toHaveBeenCalledTimes(1)
  })
  it('disables underlying OpenAI HTTP retries as well as Runner retries', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Synthetic transport failure', type: 'server_error' } }), { status: 500, headers: { 'content-type': 'application/json' } }))
    try {
      const { tools } = setup([])
      const result = await createRecoveryAgent({ enabled: true, now, apiKey: 'nonfunctional-unit-test-key', modelName: 'unit-test-model' })({ request, refinement: 'Help', tools, signal: new AbortController().signal })
      expect(result.status).toBe('limited')
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally { fetcher.mockRestore() }
  })
  it('never retries failed model calls or exposes their exception messages', async () => {
    const { tools } = setup([])
    const getResponse = vi.fn(async () => { throw new Error('PRIVATE_KEY_PROVIDER_ERROR') })
    const model: Model = { getResponse, async *getStreamedResponse() { throw new Error() } }
    const result = await createRecoveryAgent({ enabled: true, now, model })({ request, refinement: 'Help', tools, signal: new AbortController().signal })
    expect(result.status).toBe('limited')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_KEY')
    expect(getResponse).toHaveBeenCalledTimes(1)
  })
  it.each(['disabled', 'key missing', 'model missing', 'synthetic'])('does not call SDK model when %s', async mode => {
    const { model, tools } = setup([])
    const execute = createRecoveryAgent({ enabled: mode !== 'disabled', now, ...(mode === 'disabled' || mode === 'synthetic' ? { model } : {}), ...(mode === 'model missing' ? { apiKey: 'test-key' } : {}), ...(mode === 'key missing' ? { modelName: 'explicit-model' } : {}) })
    const result = await execute({ request: mode === 'synthetic' ? fixture.request : request, refinement: 'Help', tools, signal: new AbortController().signal })
    expect(result.status).toBe('unavailable')
    expect(model.requests).toHaveLength(0)
    expect(tools.assess).not.toHaveBeenCalled()
  })
})
