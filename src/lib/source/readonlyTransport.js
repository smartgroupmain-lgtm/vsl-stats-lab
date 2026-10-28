const ALLOWED_TABLES = new Set(['leagues', 'seasons', 'season_teams', 'teams', 'players', 'team_memberships', 'matches'])

export class SourceError extends Error {
  constructor(kind, message, status = null) { super(message); this.name = 'SourceError'; this.kind = kind; this.status = status }
}

function validatePublicKey(key) {
  if (!key) throw new SourceError('validation', 'Не настроен публичный ключ источника')
  if (/service_role|sb_secret_/i.test(key)) throw new SourceError('validation', 'Привилегированный ключ запрещён')
  if (key.startsWith('sb_publishable_')) return
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.role === 'anon') return
    } catch { /* fall through */ }
  }
  throw new SourceError('validation', 'Допустим только publishable/anon ключ')
}

export function createReadOnlyTransport({ sourceUrl, publicKey, fetchImpl = fetch }) {
  const origin = new URL(sourceUrl)
  if (origin.protocol !== 'https:' && origin.hostname !== 'localhost') throw new SourceError('validation', 'Источник должен использовать HTTPS')
  validatePublicKey(publicKey)

  return async function readSource(table, params = {}, { signal } = {}) {
    if (!ALLOWED_TABLES.has(table)) throw new SourceError('validation', `Таблица ${table} не разрешена`)
    const url = new URL(`/rest/v1/${table}`, origin)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      let lastError
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetchImpl(url, {
            method: 'GET', credentials: 'omit', redirect: 'error',
            headers: { apikey: publicKey, Accept: 'application/json' },
            signal: controller.signal,
          })
          if (response.ok) return await response.json()
          const text = await response.text()
          const kind = response.status === 401 || response.status === 403 ? 'access' : response.status >= 500 ? 'network' : 'schema'
          lastError = new SourceError(kind, `Источник вернул HTTP ${response.status}: ${text.slice(0, 180)}`, response.status)
          if (kind !== 'network') throw lastError
        } catch (error) {
          if (error instanceof SourceError && error.kind !== 'network') throw error
          lastError = error.name === 'AbortError' ? new SourceError('network', 'Запрос отменён или превысил время ожидания') : new SourceError('network', error.message)
        }
      }
      throw lastError
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
    }
  }
}

export function assertReadOnlyRequest(method, table) {
  if (method !== 'GET' || !ALLOWED_TABLES.has(table)) throw new SourceError('validation', 'Разрешены только GET к справочникам VSL')
  return true
}
