import { calculateStats } from '../match-engine/statistics.js'
const safe = value => {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
export function statsCsv(state) {
  if (state.meta.statsMode === 'detailed') {
    const head = ['environment','player_id','player','number','serve_ace','serve_pressure','serve_normal','serve_error','reception_0','reception_1','reception_2','reception_3','set_error','set_emergency','set_workable','set_ideal','assists','attack_point','attack_pressure','attack_in_play','attack_block_covered','attack_blocked_point','attack_error','block_point','block_softened','block_to_opponent','block_out','block_error']
    return [head, ...calculateStats(state).map(row => ['lab',row.playerId,row.name,row.number,row.detailed.serve.ace,row.detailed.serve.pressure,row.detailed.serve.normal,row.detailed.serve.error,row.detailed.reception.error,row.detailed.reception.shanked,row.detailed.reception.normal,row.detailed.reception.ideal,row.detailed.set.error,row.detailed.set.emergency,row.detailed.set.workable,row.detailed.set.ideal,row.assists,row.detailed.attack.point,row.detailed.attack.pressure,row.detailed.attack.in_play,row.detailed.attack.block_covered,row.detailed.attack.blocked_point,row.detailed.attack.error,row.detailed.block.point,row.detailed.block.softened,row.detailed.block.to_opponent,row.detailed.block.block_out,row.detailed.block.error])].map(row => row.map(safe).join(',')).join('\n')
  }
  const head = ['environment','player_id','player','number','attack_points','aces','assists','block_points','libero_positive','libero_negative','libero_balance']
  return [head, ...calculateStats(state).map(r => ['lab',r.playerId,r.name,r.number,r.attackPoints,r.aces,r.assists,r.blockPoints,r.liberoPositive,r.liberoNegative,r.liberoBalance])].map(row => row.map(safe).join(',')).join('\n')
}
export function downloadCsv(state) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + statsCsv(state)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `vsl-stats-lab-${state.id}.csv`; a.click(); URL.revokeObjectURL(url)
}
