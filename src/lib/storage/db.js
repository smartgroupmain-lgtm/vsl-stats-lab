import { openDB } from 'idb'

export const DB_NAME = 'vsl-stats-lab-v1'
export const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    const catalog = db.createObjectStore('catalog', { keyPath: 'key' }); catalog.createIndex('fetchedAt', 'fetchedAt')
    const matches = db.createObjectStore('matches', { keyPath: 'id' }); matches.createIndex('updatedAt', 'updatedAt'); matches.createIndex('status', 'status')
    const commands = db.createObjectStore('commands', { keyPath: 'commandId' }); commands.createIndex('matchId', 'matchId'); commands.createIndex('matchRevision', ['matchId', 'revision'], { unique: true })
    db.createObjectStore('snapshots', { keyPath: 'matchId' })
    const rosters = db.createObjectStore('rosterSnapshots', { keyPath: 'id' }); rosters.createIndex('matchId', 'matchId')
    db.createObjectStore('settings', { keyPath: 'key' })
  },
})
