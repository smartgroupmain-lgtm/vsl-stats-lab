export function calculateStats(state, { setId = null, teamId = null } = {}) {
  const players = Object.fromEntries(state.roster.map(p => [p.id, { playerId: p.id, name: p.displayName, number: p.jerseyNumber, teamId: p.teamId, attackPoints: 0, aces: 0, assists: 0, blockPoints: 0, liberoPositive: 0, liberoNegative: 0 }]))
  const validSets = new Set(state.sets.filter(s => !setId || s.id === setId).map(s => s.id))
  for (const e of state.events) {
    if (e.voided || !validSets.has(e.setId) || (teamId && e.teamId !== teamId)) continue
    const row = players[e.actorId]
    if (row) {
      if (e.skill === 'attack' && e.result === 'point') row.attackPoints++
      if (e.skill === 'serve' && e.result === 'ace') row.aces++
      if (e.skill === 'block' && e.result === 'point') row.blockPoints++
      if (e.skill === 'libero' && e.result === 'positive') row.liberoPositive++
      if (e.skill === 'libero' && e.result === 'negative') row.liberoNegative++
    }
    if (e.assistId && players[e.assistId]) players[e.assistId].assists++
  }
  return Object.values(players).filter(p => (!teamId || p.teamId === teamId) && (p.attackPoints + p.aces + p.assists + p.blockPoints + p.liberoPositive + p.liberoNegative > 0)).map(p => ({ ...p, liberoBalance: p.liberoPositive - p.liberoNegative }))
}

export function scoreFor(state) { return state.sets.at(-1)?.score || Object.fromEntries(state.teams.map(t => [t.id, 0])) }
