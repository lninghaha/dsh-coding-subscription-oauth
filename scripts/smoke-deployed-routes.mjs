#!/usr/bin/env node

import { randomUUID } from 'node:crypto'

const base = new URL(process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080')
const origin = base.origin
const timeoutMs = Number.parseInt(process.env.DSH_SMOKE_TIMEOUT_MS ?? '180000', 10)
const restoreProvider = process.env.DSH_RESTORE_PROVIDER
const restoreModel = process.env.DSH_RESTORE_MODEL
if (restoreProvider === undefined || restoreModel === undefined) {
  throw new Error('Set DSH_RESTORE_PROVIDER and DSH_RESTORE_MODEL before running; smoke selection updates the saved default temporarily')
}
const restoreSelection = {
  provider: restoreProvider,
  model: restoreModel,
  ...process.env.DSH_RESTORE_REASONING === undefined ? {} : { reasoningEffort: process.env.DSH_RESTORE_REASONING },
}
const cases = [
  { route: 'codex-oauth', model: process.env.DSH_CODEX_SMOKE_MODEL ?? 'gpt-5.6-sol', marker: 'DSH_CODEX_OAUTH_SMOKE_OK' },
  { route: 'kimi-code-oauth', model: process.env.DSH_KIMI_SMOKE_MODEL ?? 'k3', marker: 'DSH_KIMI_OAUTH_SMOKE_OK' },
]

async function rpc(method, payload) {
  const rpcId = randomUUID()
  const response = await fetch(new URL(`/api/${method}`, base), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', origin },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(30_000),
  })
  const envelope = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`)
  if (envelope?.rpcId !== rpcId || envelope?.result?.ok !== true) {
    throw new Error(`${method}: ${envelope?.result?.error?.message ?? 'invalid response'}`)
  }
  return envelope.result.value
}

async function waitForIdle(sessionId) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { items } = await rpc('session.list', {})
    const session = items.find(item => item.sessionId === sessionId)
    if (session === undefined) throw new Error(`session ${sessionId} disappeared`)
    if (!session.blank && !session.running) return
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`session ${sessionId} did not finish within ${timeoutMs}ms`)
}

function contentBlocks(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) contentBlocks(item, output)
  } else if (value !== null && typeof value === 'object') {
    if (typeof value.type === 'string' && ['tool-call', 'tool-result'].includes(value.type)) output.push(value)
    for (const child of Object.values(value)) contentBlocks(child, output)
  }
  return output
}

async function runSmoke(testCase) {
  const created = await rpc('session.create', { cwd: process.cwd() })
  const sessionId = created.sessionId
  let selected = false
  let failure
  try {
    await rpc('session.selectModel', {
      sessionId,
      provider: testCase.route,
      model: testCase.model,
      reasoningEffort: 'low',
    })
    selected = true
    await rpc('session.prompt', {
      sessionId,
      mode: 'queue',
      clientTimeZone: 'UTC',
      content: [{
        type: 'text',
        text: `Automated OAuth smoke test. You MUST call the glob tool exactly once with pattern "package.json" in the current workspace. After receiving the tool result, reply with exactly ${testCase.marker} and no other text.`,
      }],
    })
    await waitForIdle(sessionId)
    const history = await rpc('session.history', { sessionId, maxMessages: 200 })
    const serialized = JSON.stringify(history.events)
    const blocks = contentBlocks(history.events)
    const toolCalls = blocks.filter(block => block.type === 'tool-call').length
    const toolResults = blocks.filter(block => block.type === 'tool-result').length
    const eventTypes = [...new Set(history.events.map(entry => entry.event.type))]
    const turnErrors = eventTypes.filter(type => type.includes('error'))
    if (!serialized.includes(testCase.marker)) throw new Error(`${testCase.route}: response marker missing`)
    if (toolCalls === 0 || toolResults === 0) throw new Error(`${testCase.route}: tool-call round trip missing`)
    if (turnErrors.length > 0) throw new Error(`${testCase.route}: error events: ${turnErrors.join(', ')}`)

    const secondMarker = `${testCase.marker}_TURN2`
    await rpc('session.prompt', {
      sessionId,
      mode: 'queue',
      clientTimeZone: 'UTC',
      content: [{ type: 'text', text: `Second-turn replay test. Reply with exactly ${secondMarker} and no other text.` }],
    })
    await waitForIdle(sessionId)
    const secondHistory = await rpc('session.history', { sessionId, maxMessages: 200 })
    const secondSerialized = JSON.stringify(secondHistory.events)
    const secondEventTypes = [...new Set(secondHistory.events.map(entry => entry.event.type))]
    const secondTurnErrors = secondEventTypes.filter(type => type.includes('error'))
    if (!secondSerialized.includes(secondMarker)) throw new Error(`${testCase.route}: second-turn response marker missing`)
    if (secondTurnErrors.length > 0) throw new Error(`${testCase.route}: second-turn error events: ${secondTurnErrors.join(', ')}`)
    console.log(`${testCase.route}/${testCase.model}: twoTurns=yes toolCalls=${toolCalls} toolResults=${toolResults}`)
  } catch (error) {
    failure = error
  } finally {
    if (selected) {
      try {
        await rpc('session.selectModel', { sessionId, ...restoreSelection })
      } catch (error) {
        failure ??= new Error(`${testCase.route}: failed to restore default model: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    try {
      await rpc('workspace.archiveSession', { sessionId })
    } catch (error) {
      failure ??= new Error(`${testCase.route}: failed to archive smoke session: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failure !== undefined) throw failure
}

for (const testCase of cases) await runSmoke(testCase)
console.log('Deployed Codex/Kimi OAuth inference and tool-call smoke passed.')
