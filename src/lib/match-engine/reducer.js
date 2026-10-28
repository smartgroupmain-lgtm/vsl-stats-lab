import { CommandType } from './commands.js'

export class DomainError extends Error { constructor(code, message) { super(message); this.name = 'DomainError'; this.code = code } }
const copy = value => structuredClone(value)

function currentSet(state) {
  const set = state.sets.at(-1)
  if (!set || set.status !== 'in_progress') throw new DomainError('NO_ACTIVE_SET', 'Нет активной партии')
  return set
}
function rosterPlayer(state, id) { return state.roster.find(p => p.id === id) }
function otherTeam(state, teamId) { return state.teams.find(t => t.id !== teamId)?.id }
const detailedTerminalWinner = (state, teamId, skill, result) => {
  const ownPoint = (skill === 'serve' && result === 'ace') || (skill === 'attack' && result === 'point') || (skill === 'block' && result === 'point')
  const opponentPoint = (
    (skill === 'serve' && result === 'error') ||
    (skill === 'reception' && result === 'error') ||
    (skill === 'set' && result === 'error') ||
    (skill === 'attack' && ['blocked_point', 'error'].includes(result)) ||
    (skill === 'block' && ['block_out', 'error'].includes(result))
  )
  return ownPoint ? teamId : opponentPoint ? otherTeam(state, teamId) : null
}
export function setWinner(state, set) {
  const target = set.number === state.rules.setsToWin * 2 - 1 ? state.rules.decidingTarget : state.rules.regularTarget
  const [a, b] = state.teams.map(t => set.score[t.id] || 0)
  if (Math.max(a, b) < target || Math.abs(a - b) < (state.rules.advantage || 2)) return null
  return a > b ? state.teams[0].id : state.teams[1].id
}
function addPoint(state, set, winnerTeamId, reason, eventId = null, administrative = false, rallyId = crypto.randomUUID()) {
  if (!state.teams.some(t => t.id === winnerTeamId)) throw new DomainError('BAD_TEAM', 'Команда не найдена')
  const beforeServing = set.servingTeamId
  set.score[winnerTeamId] = (set.score[winnerTeamId] || 0) + 1
  if (!administrative && beforeServing !== winnerTeamId) {
    set.servingTeamId = winnerTeamId
    set.rotations[winnerTeamId] = ((set.rotations[winnerTeamId] || 0) + 1) % 6
  }
  const rally = { id: rallyId, number: set.rallies.length + 1, winnerTeamId, reason, eventId, administrative, scoreAfter: { ...set.score }, voided: false, recordedAt: new Date().toISOString() }
  set.rallies.push(rally)
  return rally
}

export function createEmptyState() { return { id: null, revision: 0, status: 'draft', meta: {}, rules: {}, teams: [], roster: [], sets: [], events: [], timeouts: [] } }

export function applyCommand(input, command) {
  const state = copy(input || createEmptyState())
  const p = command.payload || {}
  switch (command.type) {
    case CommandType.CREATE_MATCH:
      if (state.id) throw new DomainError('ALREADY_CREATED', 'Матч уже создан')
      Object.assign(state, { id: command.matchId, status: 'ready', meta: p.meta, rules: p.rules, teams: p.teams, roster: p.roster, sets: [], events: [] })
      break
    case CommandType.START_SET: {
      if (!state.id || state.status === 'completed') throw new DomainError('BAD_STATE', 'Нельзя начать партию')
      if (state.sets.some(s => s.status === 'in_progress')) throw new DomainError('ACTIVE_SET', 'Партия уже идёт')
      const score = Object.fromEntries(state.teams.map(t => [t.id, p.initialScore?.[t.id] || 0]))
      const rotations = Object.fromEntries(state.teams.map(t => [t.id, 0]))
      state.sets.push({ id: `${command.commandId}:set`, number: state.sets.length + 1, status: 'in_progress', score, servingTeamId: p.servingTeamId, rotations, lineups: p.lineups || {}, rallies: [], startedAt: command.recordedAt })
      state.status = 'in_progress'; break
    }
    case CommandType.RECORD_TERMINAL_ACTION: {
      const set = currentSet(state); const actor = p.actorId ? rosterPlayer(state, p.actorId) : null
      if (p.actorId && !actor) throw new DomainError('BAD_PLAYER', 'Игрок не найден')
      if (actor && actor.teamId !== p.teamId) throw new DomainError('BAD_TEAM', 'Игрок относится к другой команде')
      const event = { id: `${command.commandId}:event`, sourceCommandId: command.commandId, setId: set.id, rallyNumber: set.rallies.length + 1, teamId: p.teamId, actorId: p.actorId || null, skill: p.skill, result: p.result, assistId: null, voided: false, recordedAt: command.recordedAt }
      state.events.push(event)
      const winner = p.winnerTeamId || (p.result === 'error' ? otherTeam(state, p.teamId) : p.teamId)
      addPoint(state, set, winner, `${p.skill}:${p.result}`, event.id, false, `${command.commandId}:rally`)
      break
    }
    case CommandType.RECORD_DETAILED_ACTION: {
      const set = currentSet(state); const actor = rosterPlayer(state, p.actorId)
      if (!actor) throw new DomainError('BAD_PLAYER', 'Игрок не найден')
      if (actor.teamId !== p.teamId) throw new DomainError('BAD_TEAM', 'Игрок относится к другой команде')
      const winner = detailedTerminalWinner(state, p.teamId, p.skill, p.result)
      const event = { id: `${command.commandId}:event`, sourceCommandId: command.commandId, setId: set.id, rallyNumber: set.rallies.length + 1, teamId: p.teamId, actorId: p.actorId, skill: p.skill, result: p.result, assistId: null, voided: false, recordedAt: command.recordedAt }
      if (p.skill === 'attack' && p.result === 'point') {
        const previous = [...state.events].reverse().find(candidate => !candidate.voided && candidate.setId === set.id && candidate.rallyNumber === event.rallyNumber)
        if (previous?.teamId === p.teamId && previous.skill === 'set') {
          const pass = previous
          pass.enteredResult ||= pass.result
          pass.result = 'ideal'; pass.assist = true; pass.linkedAttackId = event.id
          event.assistId = pass.actorId; event.assistStatus = 'assigned'
        }
      }
      state.events.push(event)
      if (winner) addPoint(state, set, winner, `${p.skill}:${p.result}`, event.id, false, `${command.commandId}:rally`)
      break
    }
    case CommandType.RECORD_UNKNOWN_POINT: addPoint(state, currentSet(state), p.winnerTeamId, 'unknown', null, false, `${command.commandId}:rally`); break
    case CommandType.ASSIGN_ASSIST: {
      const attack = state.events.find(e => e.id === p.attackEventId && !e.voided)
      if (!attack || attack.skill !== 'attack' || attack.result !== 'point') throw new DomainError('BAD_ATTACK', 'Ассист возможен только для очковой атаки')
      if (p.assisterId === null) { attack.assistId = null; attack.assistStatus = 'none'; break }
      const assister = rosterPlayer(state, p.assisterId)
      if (!assister || assister.teamId !== attack.teamId || assister.id === attack.actorId) throw new DomainError('BAD_ASSIST', 'Недопустимый ассистирующий')
      attack.assistId = assister.id; attack.assistStatus = 'assigned'; break
    }
    case CommandType.RECORD_LIBERO_ASSESSMENT: {
      const set = currentSet(state); const player = rosterPlayer(state, p.rosterEntryId)
      if (!player || player.matchRole !== 'libero') throw new DomainError('NOT_LIBERO', 'Игрок не назначен либеро')
      if (!['positive', 'negative'].includes(p.sign)) throw new DomainError('BAD_SIGN', 'Неверная оценка')
      state.events.push({ id: `${command.commandId}:event`, sourceCommandId: command.commandId, setId: set.id, rallyNumber: p.rallyNumber || set.rallies.length + 1, teamId: player.teamId, actorId: player.id, skill: 'libero', result: p.sign, voided: false, recordedAt: command.recordedAt })
      break
    }
    case CommandType.SUBSTITUTE_PLAYER:
    case CommandType.REPLACE_LIBERO: {
      const set = currentSet(state); const lineup = set.lineups[p.teamId] || []
      const index = lineup.indexOf(p.outId)
      if (index < 0 || lineup.includes(p.inId)) throw new DomainError('BAD_SUBSTITUTION', 'Замена не соответствует текущему составу')
      lineup[index] = p.inId; set.lineups[p.teamId] = lineup
      state.events.push({ id: `${command.commandId}:event`, sourceCommandId: command.commandId, setId: set.id, rallyNumber: set.rallies.length + 1, scoreAtEvent: { ...set.score }, teamId: p.teamId, skill: command.type === CommandType.REPLACE_LIBERO ? 'libero-replacement' : 'substitution', result: 'completed', outId: p.outId, inId: p.inId, recordedAt: command.recordedAt })
      break
    }
    case CommandType.RECORD_TIMEOUT: state.timeouts.push({ setId: currentSet(state).id, teamId: p.teamId, recordedAt: command.recordedAt }); break
    case CommandType.RECORD_PENALTY: addPoint(state, currentSet(state), p.winnerTeamId, `penalty:${p.reason || 'other'}`, null, true, `${command.commandId}:rally`); break
    case CommandType.FINISH_SET: {
      const set = currentSet(state)
      const winner = setWinner(state, set)
      if (!winner) throw new DomainError('SET_NOT_WON', 'Партия ещё не выиграна с преимуществом в два очка')
      set.status = 'completed'; set.winnerTeamId = winner; state.status = 'between_sets'; break
    }
    case CommandType.FINISH_MATCH: {
      if (state.sets.some(s => s.status === 'in_progress')) throw new DomainError('ACTIVE_SET', 'Сначала завершите текущую партию')
      const wins = Object.fromEntries(state.teams.map(t => [t.id, state.sets.filter(s => s.winnerTeamId === t.id).length]))
      if (!state.teams.some(t => wins[t.id] >= state.rules.setsToWin)) throw new DomainError('MATCH_NOT_WON', 'Ни одна команда ещё не выиграла нужное число партий')
      state.status = 'completed'; state.completedAt = command.recordedAt; break
    }
    default: throw new DomainError('UNKNOWN_COMMAND', `Неизвестная команда ${command.type}`)
  }
  state.revision += 1
  state.updatedAt = command.recordedAt
  return { nextState: state, domainEvents: [] }
}
