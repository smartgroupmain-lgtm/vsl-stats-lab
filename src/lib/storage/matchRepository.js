import { dbPromise } from './db.js'
import { replay } from '../match-engine/replay.js'
import { applyCommand } from '../match-engine/reducer.js'
import { deleteRemoteMatch, listRemoteMatches, loadRemoteMatch, remoteSyncEnabled, saveRemoteMatch } from './remoteMatchRepository.js'

export class RevisionConflict extends Error { constructor(currentRevision) { super('Матч изменён в другой вкладке'); this.currentRevision = currentRevision } }

async function withEditorLock(matchId, fn) {
  if (navigator?.locks?.request) return navigator.locks.request(`vsl-stats-lab:${matchId}`, { mode: 'exclusive' }, fn)
  return fn()
}

const remoteQueues = new Map()
function queueRemoteSync(loaded, onSync) {
  let queue = remoteQueues.get(loaded.state.id)
  if (!queue) { queue = { latest: null, listeners: new Set(), running: false }; remoteQueues.set(loaded.state.id, queue) }
  queue.latest = loaded
  if (onSync) queue.listeners.add(onSync)
  if (queue.running) return
  queue.running = true
  void (async () => {
    let result = { ok: true }
    while (queue.latest) {
      const current = queue.latest; queue.latest = null
      try { result = await saveRemoteMatch(current) }
      catch (error) { result = { ok: false, error: error.message } }
    }
    queue.running = false; remoteQueues.delete(loaded.state.id)
    for (const listener of queue.listeners) listener(result)
  })()
}

export async function commitCommand(command, { onSync } = {}) {
  return withEditorLock(command.matchId, async () => {
    const db = await dbPromise
    const tx = db.transaction(['matches', 'commands', 'snapshots', 'rosterSnapshots'], 'readwrite')
    let meta = await tx.objectStore('matches').get(command.matchId)
    const duplicate = await tx.objectStore('commands').get(command.commandId)
    if (duplicate) { await tx.done; return loadMatch(command.matchId) }
    const currentRevision = meta?.revision || 0
    if (command.expectedRevision !== currentRevision) { tx.abort(); throw new RevisionConflict(currentRevision) }
    const existing = await tx.objectStore('commands').index('matchId').getAll(command.matchId)
    const snapshot = await tx.objectStore('snapshots').get(command.matchId)
    const record = { ...command, revision: currentRevision + 1 }
    const commands = [...existing, record].sort((a, b) => a.revision - b.revision)
    const canApplyIncrementally = snapshot?.revision === currentRevision && !['UNDO', 'REDO'].includes(command.type)
    const state = canApplyIncrementally ? applyCommand(snapshot.state, record).nextState : replay(commands)
    meta = { id: command.matchId, revision: currentRevision + 1, status: state.status, updatedAt: state.updatedAt || command.recordedAt, createdAt: meta?.createdAt || command.recordedAt, title: state.meta?.title || 'Тестовый матч', sourceMatchId: state.meta?.sourceMatchId || null }
    await tx.objectStore('commands').add(record)
    await tx.objectStore('matches').put(meta)
    await tx.objectStore('snapshots').put({ matchId: command.matchId, engineVersion: 1, revision: meta.revision, state })
    if (command.type === 'CREATE_MATCH') for (const entry of state.roster) await tx.objectStore('rosterSnapshots').put({ ...entry, matchId: command.matchId })
    await tx.done
    const loaded = { meta, commands, state }
    if (!remoteSyncEnabled()) return { ...loaded, sync: { ok: true, skipped: true } }
    queueRemoteSync(loaded, onSync)
    return { ...loaded, sync: { pending: true } }
  })
}

async function loadLocalMatch(matchId) {
  const db = await dbPromise
  const [meta, snapshot, commands] = await Promise.all([db.get('matches', matchId), db.get('snapshots', matchId), db.getAllFromIndex('commands', 'matchId', matchId)])
  if (!meta) return null
  commands.sort((a, b) => a.revision - b.revision)
  const state = snapshot?.revision === meta.revision ? snapshot.state : replay(commands)
  return { meta, commands, state }
}

async function restoreRemoteBundle(bundle) {
  let result
  for (const [index, command] of bundle.commandLog.entries()) result = await commitCommand({ ...structuredClone(command), expectedRevision: index })
  return result
}

export async function loadMatch(matchId) {
  const local = await loadLocalMatch(matchId)
  if (local) return local
  const bundle = await loadRemoteMatch(matchId)
  return bundle ? restoreRemoteBundle(bundle) : null
}

export async function listLocalMatches() {
  const db = await dbPromise
  const localRows = await db.getAll('matches')
  if (!remoteSyncEnabled()) return localRows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  try {
    const remoteRows = await listRemoteMatches()
    const merged = new Map(remoteRows.map(row => [row.id, { ...row, createdAt: row.created_at, updatedAt: row.updated_at, remoteOnly: true }]))
    for (const row of localRows) merged.set(row.id, { ...merged.get(row.id), ...row, remoteOnly: false })
    return [...merged.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  } catch { return localRows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)) }
}

export async function deleteLocalMatch(matchId) {
  await deleteRemoteMatch(matchId)
  const db = await dbPromise; const tx = db.transaction(['matches', 'commands', 'snapshots', 'rosterSnapshots'], 'readwrite')
  await tx.objectStore('matches').delete(matchId); await tx.objectStore('snapshots').delete(matchId)
  for (const item of await tx.objectStore('commands').index('matchId').getAll(matchId)) await tx.objectStore('commands').delete(item.commandId)
  for (const item of await tx.objectStore('rosterSnapshots').index('matchId').getAll(matchId)) await tx.objectStore('rosterSnapshots').delete(item.id)
  await tx.done
}

export async function importMatchBundle(bundle) {
  const newId = crypto.randomUUID()
  const sourceMatchId = bundle.match.id
  const commandIdMap = new Map(bundle.commandLog.map(c => [c.commandId, crypto.randomUUID()]))
  const commands = bundle.commandLog.map((c, i) => ({
    ...structuredClone(c),
    commandId: commandIdMap.get(c.commandId), matchId: newId, expectedRevision: i,
    payload: {
      ...c.payload,
      ...(c.payload?.targetCommandId ? { targetCommandId: commandIdMap.get(c.payload.targetCommandId) } : {}),
    },
  }))
  if (!commands.length || commands[0].type !== 'CREATE_MATCH') throw new Error('В журнале нет создания матча')
  commands[0].payload.meta = { ...commands[0].payload.meta, importedFromMatchId: bundle.match.id, title: `${commands[0].payload.meta?.title || 'Матч'} · копия` }
  let result
  for (const command of commands) result = await commitCommand(command)
  return { ...result, importedFrom: sourceMatchId }
}
