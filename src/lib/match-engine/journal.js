const playerText = player => player ? `№${player.jerseyNumber ?? '—'} ${player.displayName}` : 'игрок не указан'

const skillNames = { serve: 'Подача', reception: 'Приём', set: 'Пас', attack: 'Атака', block: 'Блок' }
const resultNames = {
  ace: 'эйс', pressure: 'усложнил', normal: 'норм', error: 'ошибка', shanked: 'сорван', ideal: 'идеальный',
  emergency: 'авария', workable: 'рабочий', point: 'очко', in_play: 'в игре', block_covered: 'блок плюс',
  blocked_point: 'блок минус', softened: 'смягчил', to_opponent: 'сопернику', block_out: 'блок-аут',
}

function actionLines(rally, event, rosterById, sequence = []) {
  if (!event) {
    if (rally.reason === 'unknown') return ['Очко без указанного автора']
    if (rally.reason?.startsWith('penalty:')) return ['Штрафное очко']
    return ['Причина очка не указана']
  }
  if (sequence.length > 1 || event.sourceCommandId && sequence.some(item => item.skill === 'set' || !['point', 'ace', 'error'].includes(item.result))) {
    return sequence.map(item => `${skillNames[item.skill] || item.skill}: ${resultNames[item.result] || item.result} — ${playerText(rosterById[item.actorId])}${item.assist ? ' · голевой пас' : ''}`)
  }
  const actor = playerText(rosterById[event.actorId])
  if (event.skill === 'attack' && event.result === 'point') {
    const assist = event.assistId ? `Пас: ${playerText(rosterById[event.assistId])}` : event.assistStatus === 'none' ? 'Пас: без ассиста' : 'Пас: не указан'
    return [`Атака: гол — ${actor}`, assist]
  }
  if (event.skill === 'serve' && event.result === 'ace') return [`Эйс — ${actor}`]
  if (event.skill === 'block' && event.result === 'point') return [`Блок — ${actor}`]
  if (event.skill === 'serve' && event.result === 'error') return [`Ошибка на подаче — ${actor}`]
  if (event.skill === 'attack' && event.result === 'error') return [`Ошибка в атаке — ${actor}`]
  return [`${event.skill}: ${event.result} — ${actor}`]
}

export function buildJournalRows(state) {
  const rosterById = Object.fromEntries(state.roster.map(player => [player.id, player]))
  const eventsById = Object.fromEntries(state.events.filter(event => !event.voided).map(event => [event.id, event]))
  const teamNames = Object.fromEntries(state.teams.map(team => [team.id, team.name]))
  return state.sets.flatMap(set => {
    const runningScore = Object.fromEntries(state.teams.map(team => [team.id, 0]))
    const rallyRows = set.rallies.filter(rally => !rally.voided).map(rally => {
      runningScore[rally.winnerTeamId] = (runningScore[rally.winnerTeamId] || 0) + 1
      const scoreAfter = rally.scoreAfter || { ...runningScore }
      return {
        ...rally,
        kind: 'rally',
        setNumber: set.number,
        winnerName: teamNames[rally.winnerTeamId] || 'Команда',
        scoreAfter,
        scoreLabel: `${scoreAfter[state.teams[0].id] || 0} : ${scoreAfter[state.teams[1].id] || 0}`,
        scoreWithTeams: `${state.teams[0].name} ${scoreAfter[state.teams[0].id] || 0} : ${scoreAfter[state.teams[1].id] || 0} ${state.teams[1].name}`,
        actionLines: actionLines(rally, eventsById[rally.eventId], rosterById, state.events.filter(event => !event.voided && event.setId === set.id && event.rallyNumber === rally.number && !['substitution', 'libero-replacement'].includes(event.skill))),
      }
    })
    const changeRows = state.events.filter(event => !event.voided && event.setId === set.id && ['substitution', 'libero-replacement'].includes(event.skill)).map(event => {
      const priorRallies = set.rallies.filter(rally => !rally.voided && rally.recordedAt <= event.recordedAt)
      const scoreAfter = event.scoreAtEvent || priorRallies.at(-1)?.scoreAfter || Object.fromEntries(state.teams.map(team => [team.id, 0]))
      return {
        id: event.id,
        kind: 'substitution',
        setNumber: set.number,
        number: event.rallyNumber || priorRallies.length + 1,
        winnerName: teamNames[event.teamId] || 'Команда',
        scoreAfter,
        scoreLabel: `${scoreAfter[state.teams[0].id] || 0} : ${scoreAfter[state.teams[1].id] || 0}`,
        actionLines: [`Ушёл: ${playerText(rosterById[event.outId])}`, `Вышел: ${playerText(rosterById[event.inId])}`],
        recordedAt: event.recordedAt,
        liberoReplacement: event.skill === 'libero-replacement',
      }
    })
    return [...rallyRows, ...changeRows].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
  }).reverse()
}
