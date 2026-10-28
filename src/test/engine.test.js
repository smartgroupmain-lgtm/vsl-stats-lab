import { describe, expect, it } from 'vitest'
import { applyCommand, createEmptyState, DomainError } from '../lib/match-engine/reducer.js'
import { CommandType } from '../lib/match-engine/commands.js'
import { calculateStats } from '../lib/match-engine/statistics.js'
import { buildJournalRows } from '../lib/match-engine/journal.js'
import { replay } from '../lib/match-engine/replay.js'

const teams = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }]
const roster = [
  { id: 'p1', teamId: 'A', displayName: 'Attacker', jerseyNumber: 1, matchRole: 'player' },
  { id: 'p2', teamId: 'A', displayName: 'Setter', jerseyNumber: 2, matchRole: 'setter' },
  { id: 'p3', teamId: 'A', displayName: 'Libero', jerseyNumber: 3, matchRole: 'libero' },
  { id: 'q1', teamId: 'B', displayName: 'Opponent', jerseyNumber: 4, matchRole: 'player' },
]
const command = (type, payload = {}, commandId = crypto.randomUUID()) => ({ commandId, matchId: 'm', type, payload, recordedAt: '2026-10-28T10:00:00Z' })
function initial(serving = 'B') {
  let state = applyCommand(createEmptyState(), command(CommandType.CREATE_MATCH, { meta: { title: 'A — B' }, rules: {}, teams, roster }, 'create')).nextState
  return applyCommand(state, command(CommandType.START_SET, { servingTeamId: serving, lineups: { A: ['p1','p2','p3'], B: ['q1'] } }, 'start')).nextState
}

describe('match engine', () => {
  it('scores an attack, rotates on sideout and assigns one assist', () => {
    let state = initial('B')
    state = applyCommand(state, command(CommandType.RECORD_TERMINAL_ACTION, { actorId: 'p1', teamId: 'A', skill: 'attack', result: 'point', winnerTeamId: 'A' }, 'attack')).nextState
    expect(state.sets[0].score.A).toBe(1); expect(state.sets[0].servingTeamId).toBe('A'); expect(state.sets[0].rotations.A).toBe(1)
    const attack = state.events.find(e => e.skill === 'attack')
    state = applyCommand(state, command(CommandType.ASSIGN_ASSIST, { attackEventId: attack.id, assisterId: 'p2' }, 'assist')).nextState
    expect(calculateStats(state).find(x => x.playerId === 'p1').attackPoints).toBe(1)
    expect(calculateStats(state).find(x => x.playerId === 'p2').assists).toBe(1)
    expect(buildJournalRows(state)[0]).toMatchObject({ setNumber: 1, number: 1, scoreLabel: '1 : 0', winnerName: 'A' })
    expect(buildJournalRows(state)[0].actionLines).toEqual(['Атака: гол — №1 Attacker', 'Пас: №2 Setter'])
  })
  it('shows a running score and readable action for every rally', () => {
    let state = initial('A')
    state = applyCommand(state, command(CommandType.RECORD_TERMINAL_ACTION, { actorId: 'p1', teamId: 'A', skill: 'serve', result: 'ace', winnerTeamId: 'A' }, 'ace')).nextState
    state = applyCommand(state, command(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: 'B' }, 'unknown')).nextState
    const rows = buildJournalRows(state)
    expect(rows[0]).toMatchObject({ number: 2, scoreLabel: '1 : 1', winnerName: 'B', actionLines: ['Очко без указанного автора'] })
    expect(rows[1]).toMatchObject({ number: 1, scoreLabel: '1 : 0', actionLines: ['Эйс — №1 Attacker'] })
  })
  it('does not rotate when serving team wins', () => {
    let state = initial('A')
    state = applyCommand(state, command(CommandType.RECORD_TERMINAL_ACTION, { actorId: 'p1', teamId: 'A', skill: 'serve', result: 'ace', winnerTeamId: 'A' })).nextState
    expect(state.sets[0].rotations.A).toBe(0)
  })
  it('libero plus/minus never changes score', () => {
    let state = initial()
    for (let i=0;i<12;i++) state = applyCommand(state, command(CommandType.RECORD_LIBERO_ASSESSMENT, { rosterEntryId: 'p3', sign: 'positive' })).nextState
    for (let i=0;i<4;i++) state = applyCommand(state, command(CommandType.RECORD_LIBERO_ASSESSMENT, { rosterEntryId: 'p3', sign: 'negative' })).nextState
    expect(state.sets[0].score).toEqual({ A: 0, B: 0 })
    expect(calculateStats(state).find(x => x.playerId === 'p3')).toMatchObject({ liberoPositive: 12, liberoNegative: 4, liberoBalance: 8 })
  })
  it('rejects self and opponent assists', () => {
    let state = initial()
    state = applyCommand(state, command(CommandType.RECORD_TERMINAL_ACTION, { actorId: 'p1', teamId: 'A', skill: 'attack', result: 'point' })).nextState
    const id = state.events[0].id
    expect(() => applyCommand(state, command(CommandType.ASSIGN_ASSIST, { attackEventId: id, assisterId: 'p1' }))).toThrow(DomainError)
    expect(() => applyCommand(state, command(CommandType.ASSIGN_ASSIST, { attackEventId: id, assisterId: 'q1' }))).toThrow(DomainError)
  })
  it('undo removes attack and linked assist on replay', () => {
    const commands = [
      command(CommandType.CREATE_MATCH, { meta: {}, rules: {}, teams, roster }, 'create'),
      command(CommandType.START_SET, { servingTeamId: 'B', lineups: {} }, 'start'),
      command(CommandType.RECORD_TERMINAL_ACTION, { actorId: 'p1', teamId: 'A', skill: 'attack', result: 'point' }, 'attack'),
      command(CommandType.UNDO, { targetCommandId: 'attack' }, 'undo'),
    ]
    const state = replay(commands)
    expect(state.sets[0].score.A).toBe(0); expect(state.events).toHaveLength(0)
  })
  it('keeps event ids stable during replay so assists survive', () => {
    const commands = [
      command(CommandType.CREATE_MATCH, { meta: {}, rules: { setsToWin: 3, regularTarget: 25, decidingTarget: 15, advantage: 2 }, teams, roster }, 'create'),
      command(CommandType.START_SET, { servingTeamId: 'B', lineups: {} }, 'start'),
      command(CommandType.RECORD_TERMINAL_ACTION, { actorId: 'p1', teamId: 'A', skill: 'attack', result: 'point' }, 'attack'),
      command(CommandType.ASSIGN_ASSIST, { attackEventId: 'attack:event', assisterId: 'p2' }, 'assist'),
    ]
    const state = replay(commands)
    expect(state.events[0].id).toBe('attack:event')
    expect(calculateStats(state).find(x => x.playerId === 'p2').assists).toBe(1)
  })
  it('requires target score and two-point advantage to finish a set', () => {
    let state = initial('A'); state.rules = { setsToWin: 3, regularTarget: 25, decidingTarget: 15, advantage: 2 }
    for (let i=0;i<24;i++) state = applyCommand(state, command(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: 'A' }, `a${i}`)).nextState
    for (let i=0;i<24;i++) state = applyCommand(state, command(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: 'B' }, `b${i}`)).nextState
    state = applyCommand(state, command(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: 'A' }, 'a25')).nextState
    expect(() => applyCommand(state, command(CommandType.FINISH_SET))).toThrow(/преимуществом/)
    state = applyCommand(state, command(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: 'A' }, 'a26')).nextState
    expect(applyCommand(state, command(CommandType.FINISH_SET)).nextState.sets[0].winnerTeamId).toBe('A')
  })
  it('keeps detailed nonterminal actions in one unfinished rally without changing score', () => {
    let state = initial('A')
    state = applyCommand(state, command(CommandType.RECORD_DETAILED_ACTION, { actorId: 'p1', teamId: 'A', skill: 'serve', result: 'pressure' }, 'pressure')).nextState
    state = applyCommand(state, command(CommandType.RECORD_DETAILED_ACTION, { actorId: 'p1', teamId: 'A', skill: 'block', result: 'to_opponent' }, 'opponent')).nextState
    expect(state.sets[0].score).toEqual({ A: 0, B: 0 })
    expect(state.events.map(event => event.rallyNumber)).toEqual([1, 1])
    expect(calculateStats(state).find(row => row.playerId === 'p1').detailed.block.to_opponent).toBe(1)
  })
  it('makes the latest pass ideal and assigns the assist when a linked attack scores', () => {
    let state = initial('B')
    state = applyCommand(state, command(CommandType.RECORD_DETAILED_ACTION, { actorId: 'p2', teamId: 'A', skill: 'set', result: 'workable' }, 'pass')).nextState
    state = applyCommand(state, command(CommandType.RECORD_DETAILED_ACTION, { actorId: 'p1', teamId: 'A', skill: 'attack', result: 'point' }, 'attack')).nextState
    expect(state.sets[0].score.A).toBe(1)
    expect(state.events[0]).toMatchObject({ result: 'ideal', enteredResult: 'workable', assist: true, linkedAttackId: 'attack:event' })
    expect(state.events[1]).toMatchObject({ assistId: 'p2', assistStatus: 'assigned' })
    expect(calculateStats(state).find(row => row.playerId === 'p2')).toMatchObject({ assists: 1 })
    expect(buildJournalRows(state)[0].actionLines).toEqual(['Пас: идеальный — №2 Setter · голевой пас', 'Атака: очко — №1 Attacker'])
  })
  it('does not assign an assist when another team contact follows the pass', () => {
    let state = initial()
    state = applyCommand(state, command(CommandType.RECORD_DETAILED_ACTION, { actorId: 'p2', teamId: 'A', skill: 'set', result: 'workable' }, 'pass')).nextState
    state = applyCommand(state, command(CommandType.RECORD_DETAILED_ACTION, { actorId: 'p1', teamId: 'A', skill: 'block', result: 'softened' }, 'touch')).nextState
    state = applyCommand(state, command(CommandType.RECORD_DETAILED_ACTION, { actorId: 'p1', teamId: 'A', skill: 'attack', result: 'point' }, 'attack')).nextState
    expect(state.events[0].result).toBe('workable')
    expect(state.events[0].assist).toBeUndefined()
    expect(state.events[2].assistId).toBeNull()
  })
  it('maps every detailed terminal result to the correct team', () => {
    const cases = [
      ['serve', 'ace', 'A'], ['serve', 'error', 'B'], ['reception', 'error', 'B'], ['set', 'error', 'B'],
      ['attack', 'point', 'A'], ['attack', 'blocked_point', 'B'], ['attack', 'error', 'B'],
      ['block', 'point', 'A'], ['block', 'block_out', 'B'], ['block', 'error', 'B'],
    ]
    for (const [skill, result, winner] of cases) {
      const state = applyCommand(initial(), command(CommandType.RECORD_DETAILED_ACTION, { actorId: 'p1', teamId: 'A', skill, result })).nextState
      expect(state.sets[0].score[winner], `${skill}:${result}`).toBe(1)
    }
  })
})
