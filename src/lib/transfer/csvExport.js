import { calculateStats } from '../match-engine/statistics.js'
const safe = value => {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
export function statsCsv(state) {
  const head = ['environment','player_id','player','number','attack_points','aces','assists','block_points','libero_positive','libero_negative','libero_balance']
  return [head, ...calculateStats(state).map(r => ['lab',r.playerId,r.name,r.number,r.attackPoints,r.aces,r.assists,r.blockPoints,r.liberoPositive,r.liberoNegative,r.liberoBalance])].map(row => row.map(safe).join(',')).join('\n')
}
export function downloadCsv(state) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + statsCsv(state)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `vsl-stats-lab-${state.id}.csv`; a.click(); URL.revokeObjectURL(url)
}
