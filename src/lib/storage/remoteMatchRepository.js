import { config } from '../../config.js'
import { makeBundle, validateBundle } from '../transfer/jsonBundle.js'

const enabled = Boolean(config.sourceUrl && config.sourceKey && config.syncAccessKey)

async function rpc(name, body) {
  if (!enabled) return null
  const response = await fetch(`${config.sourceUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.sourceKey,
      Authorization: `Bearer ${config.sourceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}))
    throw new Error(detail.message || `Сервер статистики ответил ${response.status}`)
  }
  if (response.status === 204) return null
  return response.json()
}

export function remoteSyncEnabled() { return enabled }

export async function saveRemoteMatch(loaded) {
  if (!enabled) return { ok: true, skipped: true }
  await rpc('stats_lab_upsert_match', {
    p_access_key: config.syncAccessKey,
    p_match_id: loaded.state.id,
    p_title: loaded.meta.title,
    p_status: loaded.meta.status,
    p_revision: loaded.meta.revision,
    p_bundle: makeBundle(loaded),
  })
  return { ok: true }
}

export async function listRemoteMatches() {
  if (!enabled) return []
  return rpc('stats_lab_list_matches', { p_access_key: config.syncAccessKey })
}

export async function loadRemoteMatch(matchId) {
  if (!enabled) return null
  const rows = await rpc('stats_lab_get_match', { p_access_key: config.syncAccessKey, p_match_id: matchId })
  const bundle = Array.isArray(rows) ? rows[0]?.bundle : rows?.bundle
  return bundle ? validateBundle(bundle) : null
}

export async function deleteRemoteMatch(matchId) {
  if (!enabled) return
  await rpc('stats_lab_delete_match', { p_access_key: config.syncAccessKey, p_match_id: matchId })
}
