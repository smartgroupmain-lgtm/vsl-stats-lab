import { describe, expect, it, vi } from 'vitest'
import { assertReadOnlyRequest, createReadOnlyTransport, SourceError } from '../lib/source/readonlyTransport.js'
import { mapRoster } from '../lib/source/vslCatalogReader.js'

describe('read-only source', () => {
  it('rejects mutations and non-allowlisted tables before fetch', () => {
    expect(() => assertReadOnlyRequest('POST','teams')).toThrow(SourceError)
    expect(() => assertReadOnlyRequest('GET','match_stats')).toThrow(SourceError)
  })
  it('uses GET without credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const read = createReadOnlyTransport({ sourceUrl: 'https://project.supabase.co', publicKey: 'sb_publishable_test_public_key', fetchImpl })
    await read('teams', { select: 'id,name' })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' })
    expect(fetchImpl.mock.calls[0][0].pathname).toBe('/rest/v1/teams')
  })
  it('rejects service role keys', () => {
    expect(() => createReadOnlyTransport({ sourceUrl: 'https://project.supabase.co', publicKey: 'service_role.secret' })).toThrow(SourceError)
  })
  it('recognizes setter and libero from either source position', () => {
    const memberships = [
      { id: 'm1', player_id: 'p1', jersey_number: 4, is_captain: false, left_at: null, players: { name: 'Setter', position: 'outside', position2: 'setter', photo_url: null } },
      { id: 'm2', player_id: 'p2', jersey_number: 7, is_captain: false, left_at: null, players: { name: 'Libero', position: 'libero', position2: null, photo_url: null } },
    ]
    const roster = mapRoster(memberships, { teamId: 'team', seasonId: 'season', teamSnapshotId: 'snapshot' })
    expect(roster.map(player => player.matchRole)).toEqual(['setter', 'libero'])
  })
})
