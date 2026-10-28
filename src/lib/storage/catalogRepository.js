import { dbPromise } from './db.js'
export async function cacheCatalog(key, value) { const db = await dbPromise; await db.put('catalog', { key, value, fetchedAt: new Date().toISOString() }) }
export async function readCatalog(key) { const db = await dbPromise; return db.get('catalog', key) }
