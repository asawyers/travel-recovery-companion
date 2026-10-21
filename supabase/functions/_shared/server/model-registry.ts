/** Server-owned model choices by application role; credentials stay in Edge secrets. */
export const MODEL_REGISTRY = Object.freeze({
  recovery: Object.freeze({
    provider: 'openai',
    id: 'gpt-6-luna',
  }),
})
