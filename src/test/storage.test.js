import { beforeEach, describe, expect, it } from 'vitest'
import { dbPromise } from '../lib/storage/db.js'
import { commitCommand, loadMatch } from '../lib/storage/matchRepository.js'
import { CommandType, makeCommand } from '../lib/match-engine/commands.js'

describe('local repository', () => {
  beforeEach(async () => {
    const db = await dbPromise
    const tx = db.transaction(['matches','commands','snapshots','rosterSnapshots','catalog','settings'], 'readwrite')
    await Promise.all([...tx.objectStoreNames].map(name => tx.objectStore(name).clear()))
    await tx.done
  })
  it('is idempotent for duplicate commandId', async () => {
    const matchId = crypto.randomUUID()
    const create = makeCommand(CommandType.CREATE_MATCH, matchId, 0, { meta: { title: 'Test' }, rules: {}, teams: [{id:'A',name:'A'},{id:'B',name:'B'}], roster: [] })
    const once = await commitCommand(create); const twice = await commitCommand(create)
    expect(once.meta.revision).toBe(1); expect(twice.meta.revision).toBe(1); expect((await loadMatch(matchId)).commands).toHaveLength(1)
  })
})
