const PAGE_SIZE = 500

async function paged(read, table, params, options) {
  const rows = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const chunk = await read(table, { ...params, limit: PAGE_SIZE, offset }, options)
    rows.push(...chunk)
    if (chunk.length < PAGE_SIZE) return rows
  }
}

export function createCatalogReader(read) {
  return {
    listLeagues: ({ signal } = {}) => paged(read, 'leagues', { select: 'id,name,display_name,gender,active,sort_order,created_at', active: 'eq.true', order: 'sort_order.asc,created_at.asc' }, { signal }),
    listSeasons: ({ signal } = {}) => paged(read, 'seasons', { select: 'id,name,is_current,created_at', order: 'created_at.desc' }, { signal }),
    async listSeasonTeams({ leagueName, seasonId, signal }) {
      const [links, teams] = await Promise.all([
        paged(read, 'season_teams', { select: 'season_id,team_id', season_id: `eq.${seasonId}`, order: 'team_id.asc' }, { signal }),
        paged(read, 'teams', { select: 'id,name,league,photo_url,active', league: `eq.${leagueName}`, order: 'name.asc' }, { signal }),
      ])
      const ids = new Set(links.map(x => x.team_id))
      return teams.filter(team => ids.has(team.id))
    },
    getTeamRoster: ({ teamId, seasonId, signal }) => paged(read, 'team_memberships', {
      select: 'id,player_id,team_id,season_id,jersey_number,is_captain,joined_at,left_at,players(id,name,position,position2,photo_url)',
      team_id: `eq.${teamId}`, season_id: `eq.${seasonId}`, order: 'jersey_number.asc.nullslast,id.asc',
    }, { signal }),
    listSourceMatches: ({ leagueName, seasonId, signal }) => paged(read, 'matches', {
      select: 'id,league,season_id,home_team_id,away_team_id,match_date,venue,status', league: `eq.${leagueName}`, season_id: `eq.${seasonId}`, order: 'match_date.desc',
    }, { signal }),
  }
}

export function mapRoster(memberships, { teamId, seasonId, teamSnapshotId }) {
  const seen = new Set()
  return memberships.filter(m => {
    if (!m.players || seen.has(m.player_id)) return false
    seen.add(m.player_id); return true
  }).map(m => {
    const isLibero = m.players.position === 'libero' || m.players.position2 === 'libero'
    const isSetter = m.players.position === 'setter' || m.players.position2 === 'setter'
    return ({
    id: crypto.randomUUID(), sourcePlayerId: m.player_id, sourceMembershipId: m.id,
    teamId: teamSnapshotId, sourceTeamId: teamId, sourceSeasonId: seasonId,
    displayName: m.players.name, jerseyNumber: m.jersey_number ?? null,
    sourcePosition: m.players.position || null, sourcePosition2: m.players.position2 || null,
    matchRole: isLibero ? 'libero' : isSetter ? 'setter' : 'player',
    isCaptain: Boolean(m.is_captain), photoUrl: m.players.photo_url || null,
    fetchedAt: new Date().toISOString(), localOverrides: {}, active: !m.left_at,
    })
  })
}
