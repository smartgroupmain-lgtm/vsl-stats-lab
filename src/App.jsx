import { useEffect, useRef, useState } from 'react'
import { config } from './config.js'
import UpdateBanner from './components/UpdateBanner.jsx'
import { createReadOnlyTransport } from './lib/source/readonlyTransport.js'
import { createCatalogReader, mapRoster } from './lib/source/vslCatalogReader.js'
import { demoCatalog, demoRoster } from './lib/source/demoCatalog.js'
import { cacheCatalog, readCatalog } from './lib/storage/catalogRepository.js'
import { commitCommand, deleteLocalMatch, importMatchBundle, listLocalMatches, loadMatch } from './lib/storage/matchRepository.js'
import { CommandType, makeCommand } from './lib/match-engine/commands.js'
import { calculateStats } from './lib/match-engine/statistics.js'
import { buildJournalRows } from './lib/match-engine/journal.js'
import { latestRedoable, latestUndoable } from './lib/match-engine/replay.js'
import { downloadJson, validateBundle } from './lib/transfer/jsonBundle.js'
import { downloadCsv } from './lib/transfer/csvExport.js'

const sourceReader = (() => {
  try { return createCatalogReader(createReadOnlyTransport({ sourceUrl: config.sourceUrl, publicKey: config.sourceKey })) }
  catch { return null }
})()

const teamLabel = team => team?.name || 'Команда'
const playerLabel = player => `${player.jerseyNumber != null ? `№${player.jerseyNumber} ` : ''}${player.displayName}`
const normalizeMatchRole = role => role === 'setter' || role === 'libero' ? role : 'player'
function initializeMatchRoster(roster) {
  const normalized = roster.map(player => ({ ...player, matchRole: normalizeMatchRole(player.matchRole), available: player.active, starter: false }))
  const initialStarters = new Set([
    ...normalized.filter(player => player.available && player.matchRole !== 'libero').slice(0, 6).map(player => player.id),
    ...normalized.filter(player => player.available && player.matchRole === 'libero').slice(0, 1).map(player => player.id),
  ])
  return normalized.map(player => ({ ...player, starter: initialStarters.has(player.id) }))
}
function lineupCounts(roster) {
  const available = roster.filter(player => player.active && player.available)
  return {
    available: available.length,
    court: available.filter(player => player.starter && player.matchRole !== 'libero').length,
    libero: available.filter(player => player.starter && player.matchRole === 'libero').length,
    setters: available.filter(player => player.matchRole === 'setter').length,
  }
}
const rosterReady = roster => { const counts = lineupCounts(roster); return counts.available >= 7 && counts.court === 6 && counts.libero === 1 && counts.setters >= 1 }
const detailedActions = {
  serve: [{ result: 'ace', label: 'Эйс', terminal: 'own' }, { result: 'pressure', label: 'Усложнил' }, { result: 'normal', label: 'Норм' }, { result: 'error', label: 'Ошибка', terminal: 'opponent' }],
  reception: [{ result: 'error', label: 'Ошибка · 0', terminal: 'opponent' }, { result: 'shanked', label: 'Сорван · 1' }, { result: 'normal', label: 'Норм · 2' }, { result: 'ideal', label: 'Идеальный · 3' }],
  set: [{ result: 'error', label: 'Ошибка', terminal: 'opponent' }, { result: 'emergency', label: 'Авария' }, { result: 'workable', label: 'Рабочий' }, { result: 'ideal', label: 'Идеальный' }],
  attack: [{ result: 'point', label: 'Очко', terminal: 'own' }, { result: 'pressure', label: 'Усложнил' }, { result: 'in_play', label: 'В игре' }, { result: 'block_covered', label: 'Блок плюс' }, { result: 'blocked_point', label: 'Блок минус', terminal: 'opponent' }, { result: 'error', label: 'Ошибка', terminal: 'opponent' }],
  block: [{ result: 'point', label: 'Очко', terminal: 'own' }, { result: 'softened', label: 'Смягчил' }, { result: 'to_opponent', label: 'Сопернику' }, { result: 'block_out', label: 'Блок-аут', terminal: 'opponent' }, { result: 'error', label: 'Ошибка', terminal: 'opponent' }],
}
const skillLabels = { serve: 'Подача', reception: 'Приём', set: 'Пас', attack: 'Атака', block: 'Блок' }

function Spinner() { return <div className="spinner" aria-label="Загрузка" /> }
function SaveMark({ status }) { return <span className={`save-mark ${status}`}>{status === 'saving' ? 'Сохраняется…' : status === 'server-error' ? 'На устройстве · сервер недоступен' : status === 'error' ? 'Не сохранено' : 'Сохранено на сервере'}</span> }

function Home({ matches, onNew, onOpen, onImport, onDelete }) {
  return <main className="page narrow">
    <section className="hero"><p className="eyebrow">Песочница VSL</p><h1>Статистика матча<br/><span>без риска для лиги</span></h1><p>Составы читаются из VSL. Тестовые матчи сохраняются в отдельной серверной зоне и доступны с телефона.</p><div className="hero-actions"><button className="primary" onClick={onNew}>Новый тестовый матч</button><label className="button ghost">Импорт JSON<input type="file" accept="application/json" hidden onChange={onImport}/></label></div></section>
    <section><div className="section-head"><h2>Тестовые матчи</h2><span>{matches.length}</span></div>
      {matches.length === 0 ? <div className="empty">Пока нет сохранённых матчей.</div> : <div className="match-list">{matches.map(m => <article className="match-row" key={m.id}><button className="match-open" onClick={() => onOpen(m.id)}><b>{m.title}</b><span>{new Date(m.updatedAt).toLocaleString('ru-RU')} · {m.status}</span></button><button className="icon danger" title="Удалить" onClick={() => onDelete(m.id)}>×</button></article>)}</div>}
    </section>
  </main>
}

function RoleRoster({ roster, team, onRoleChange, onAvailabilityChange, onStarterChange }) {
  const sourceRoster = roster.filter(player => player.active); const counts = lineupCounts(roster)
  return <div className="role-team"><div className="role-team-head"><h3>{team.name}</h3><span>В матче {counts.available} · старт {counts.court}+{counts.libero} · связ. {counts.setters}</span></div><div className="role-roster">{sourceRoster.map(player => <div key={player.id} className={`role-player ${player.matchRole} ${player.available ? '' : 'absent'} ${player.starter ? 'starter' : ''}`}><span><b>№{player.jerseyNumber ?? '—'}</b> {player.displayName}</span><label className="attendance"><input type="checkbox" checked={player.available} onChange={event => onAvailabilityChange(player.id, event.target.checked)}/><span>В матче</span></label><select aria-label={`Роль ${player.displayName}`} value={player.matchRole} disabled={!player.available} onChange={event => onRoleChange(player.id, event.target.value)}><option value="player">Игрок</option><option value="setter">Связующий</option><option value="libero">Либеро</option></select><button type="button" className={`starter-toggle ${player.starter ? 'active' : ''}`} disabled={!player.available} onClick={() => onStarterChange(player.id)}>{player.starter ? 'В старте' : 'Запас'}</button></div>)}</div>{!rosterReady(roster) && <div className="team-lineup-warning">Нужно: 6 полевых + 1 либеро в старте и минимум 1 связующий среди участников</div>}</div>
}

function Prepare({ onCancel, onCreated }) {
  const [mode, setMode] = useState(sourceReader ? 'source' : 'demo')
  const [leagues, setLeagues] = useState([]); const [seasons, setSeasons] = useState([]); const [teams, setTeams] = useState([])
  const [league, setLeague] = useState(''); const [season, setSeason] = useState(''); const [teamA, setTeamA] = useState(''); const [teamB, setTeamB] = useState('')
  const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const [serving, setServing] = useState('A')
  const [statsMode, setStatsMode] = useState('quick')
  const [prepared, setPrepared] = useState(null)
  const requestRef = useRef(0)

  useEffect(() => { loadBase(mode) }, [mode])
  // Смена пары фильтров намеренно перезапускает загрузку; stale-ответ отсекается requestRef.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (league && season) loadTeams() }, [league, season])

  async function loadBase(nextMode) {
    setError(''); setPrepared(null); setLoading(true)
    if (nextMode === 'demo') { setLeagues(demoCatalog.leagues); setSeasons(demoCatalog.seasons); setLeague('demo'); setSeason('demo-season'); setLoading(false); return }
    try {
      const [ls, ss] = await Promise.all([sourceReader.listLeagues(), sourceReader.listSeasons()])
      setLeagues(ls); setSeasons(ss); setLeague(ls[0]?.name || ''); setSeason(ss.find(s => s.is_current)?.id || ss[0]?.id || '')
      await Promise.all([cacheCatalog('leagues', ls), cacheCatalog('seasons', ss)])
    } catch (e) {
      const [lc, sc] = await Promise.all([readCatalog('leagues'), readCatalog('seasons')])
      if (lc?.value?.length && sc?.value?.length) { setLeagues(lc.value); setSeasons(sc.value); setLeague(lc.value[0].name); setSeason(sc.value.find(s => s.is_current)?.id || sc.value[0].id); setError('Источник недоступен — показан сохранённый справочник') }
      else setError(`${e.message}. Можно перейти в деморежим.`)
    } finally { setLoading(false) }
  }
  async function loadTeams() {
    const request = ++requestRef.current; setLoading(true); setError(''); setPrepared(null); setTeams([]); setTeamA(''); setTeamB('')
    try {
      const rows = mode === 'demo' ? demoCatalog.teams : await sourceReader.listSeasonTeams({ leagueName: league, seasonId: season })
      if (request !== requestRef.current) return
      setTeams(rows); setTeamA(rows[0]?.id || ''); setTeamB(rows[1]?.id || '')
      await cacheCatalog(`teams:${league}:${season}`, rows)
    } catch (e) {
      const cached = await readCatalog(`teams:${league}:${season}`)
      if (request !== requestRef.current) return
      if (cached?.value) { setTeams(cached.value); setTeamA(cached.value[0]?.id || ''); setTeamB(cached.value[1]?.id || ''); setError('Показаны команды из локального кеша') }
      else setError(e.message)
    } finally { if (request === requestRef.current) setLoading(false) }
  }
  async function prepareRosters() {
    if (!teamA || !teamB || teamA === teamB) { setError('Выберите две разные команды'); return }
    setLoading(true); setError('')
    try {
      const matchId = crypto.randomUUID(); const aSnapshot = crypto.randomUUID(); const bSnapshot = crypto.randomUUID()
      const [rawA, rawB] = mode === 'demo'
        ? [demoRoster(teamA, season, aSnapshot), demoRoster(teamB, season, bSnapshot)]
        : await Promise.all([sourceReader.getTeamRoster({ teamId: teamA, seasonId: season }), sourceReader.getTeamRoster({ teamId: teamB, seasonId: season })])
      const rosterA = initializeMatchRoster(mode === 'demo' ? rawA : mapRoster(rawA, { teamId: teamA, seasonId: season, teamSnapshotId: aSnapshot }))
      const rosterB = initializeMatchRoster(mode === 'demo' ? rawB : mapRoster(rawB, { teamId: teamB, seasonId: season, teamSnapshotId: bSnapshot }))
      if (!rosterA.length || !rosterB.length) throw new Error('В одной из команд нет доступного состава')
      const teamsLocal = [{ id: aSnapshot, sourceTeamId: teamA, name: teamLabel(teams.find(t => t.id === teamA)) }, { id: bSnapshot, sourceTeamId: teamB, name: teamLabel(teams.find(t => t.id === teamB)) }]
      setPrepared({ matchId, aSnapshot, bSnapshot, teamsLocal, rosterA, rosterB })
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  function updateRole(rosterKey, playerId, matchRole) {
    setPrepared(current => ({ ...current, [rosterKey]: current[rosterKey].map(p => p.id === playerId ? { ...p, matchRole } : p) }))
  }
  function updateAvailability(rosterKey, playerId, available) {
    setPrepared(current => ({ ...current, [rosterKey]: current[rosterKey].map(player => player.id === playerId ? { ...player, available, starter: available ? player.starter : false } : player) }))
  }
  function updateStarter(rosterKey, playerId) {
    setPrepared(current => ({ ...current, [rosterKey]: current[rosterKey].map(player => player.id === playerId ? { ...player, starter: player.available ? !player.starter : false } : player) }))
  }
  async function create() {
    if (!prepared) return
    const { matchId, aSnapshot, bSnapshot, teamsLocal, rosterA, rosterB } = prepared
    if (!rosterReady(rosterA) || !rosterReady(rosterB)) { setError('Для каждой команды выберите участников, шесть полевых и одного либеро в старт, а также минимум одного связующего'); return }
    const matchRosterA = rosterA.map(player => ({ ...player, active: player.active && player.available })); const matchRosterB = rosterB.map(player => ({ ...player, active: player.active && player.available }))
    const selectedA = matchRosterA.filter(player => player.active && player.starter && player.matchRole !== 'libero'); const selectedB = matchRosterB.filter(player => player.active && player.starter && player.matchRole !== 'libero')
    setLoading(true); setError('')
    try {
      let loaded = await commitCommand(makeCommand(CommandType.CREATE_MATCH, matchId, 0, { meta: { title: `${teamsLocal[0].name} — ${teamsLocal[1].name}`, sourceLeague: league, sourceSeasonId: season, environment: 'lab', statsMode }, rules: { setsToWin: 3, regularTarget: 25, decidingTarget: 15, advantage: 2 }, teams: teamsLocal, roster: [...matchRosterA, ...matchRosterB] }))
      loaded = await commitCommand(makeCommand(CommandType.START_SET, matchId, loaded.meta.revision, { servingTeamId: serving === 'A' ? aSnapshot : bSnapshot, lineups: { [aSnapshot]: selectedA.map(p => p.id), [bSnapshot]: selectedB.map(p => p.id) } }))
      onCreated(loaded)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  const rolesReady = prepared && rosterReady(prepared.rosterA) && rosterReady(prepared.rosterB)
  return <main className="page narrow"><button className="back" onClick={onCancel}>← К матчам</button><div className="title"><p className="eyebrow">Подготовка</p><h1>Новый тестовый матч</h1></div>
    <div className="mode-tabs"><button className={mode === 'source' ? 'active' : ''} disabled={!sourceReader} onClick={() => { setPrepared(null); setMode('source') }}>Данные VSL</button><button className={mode === 'demo' ? 'active' : ''} onClick={() => { setPrepared(null); setMode('demo') }}>Деморежим</button></div>
    {loading && <Spinner/>}{error && <div className="notice warn">{error}</div>}
    <section className="form-card"><label>Лига<select value={league} onChange={e => { setPrepared(null); setLeague(e.target.value) }}>{leagues.map(l => <option key={l.id} value={l.name}>{l.display_name}</option>)}</select></label><label>Сезон<select value={season} onChange={e => { setPrepared(null); setSeason(e.target.value) }}>{seasons.map(s => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' · текущий' : ''}</option>)}</select></label>
      <div className="versus"><label>Команда 1<select value={teamA} onChange={e => { setPrepared(null); setTeamA(e.target.value) }}>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><b>VS</b><label>Команда 2<select value={teamB} onChange={e => { setPrepared(null); setTeamB(e.target.value) }}>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
      <fieldset className="stats-mode-picker"><legend>Режим статистики</legend><label className="radio"><input type="radio" checked={statsMode === 'quick'} onChange={() => setStatsMode('quick')}/><span><b>Быстрая</b><small>Только ключевые результаты</small></span></label><label className="radio"><input type="radio" checked={statsMode === 'detailed'} onChange={() => setStatsMode('detailed')}/><span><b>Подробная</b><small>Каждое действие игрока</small></span></label></fieldset>
      <fieldset><legend>Кто подаёт первым</legend><label className="radio"><input type="radio" checked={serving === 'A'} onChange={() => setServing('A')}/>{teams.find(t => t.id === teamA)?.name || 'Команда 1'}</label><label className="radio"><input type="radio" checked={serving === 'B'} onChange={() => setServing('B')}/>{teams.find(t => t.id === teamB)?.name || 'Команда 2'}</label></fieldset>
      {!prepared ? <button className="primary wide" disabled={loading || !teams.length} onClick={prepareRosters}>Загрузить составы и роли</button> : <><div className="role-review"><div className="role-review-head"><div><p className="eyebrow">Обязательный шаг</p><h2>Участники и стартовый состав</h2></div><button className="ghost" onClick={prepareRosters}>Обновить составы</button></div><p>Уберите отсутствующих, проверьте амплуа и выберите старт: шесть полевых игроков плюс один либеро. Эти настройки сохранятся только в тестовом матче.</p><RoleRoster roster={prepared.rosterA} team={prepared.teamsLocal[0]} onRoleChange={(playerId, role) => updateRole('rosterA', playerId, role)} onAvailabilityChange={(playerId, available) => updateAvailability('rosterA', playerId, available)} onStarterChange={playerId => updateStarter('rosterA', playerId)}/><RoleRoster roster={prepared.rosterB} team={prepared.teamsLocal[1]} onRoleChange={(playerId, role) => updateRole('rosterB', playerId, role)} onAvailabilityChange={(playerId, available) => updateAvailability('rosterB', playerId, available)} onStarterChange={playerId => updateStarter('rosterB', playerId)}/>{!rolesReady && <div className="role-required">Для обеих команд нужен старт 6+1 и минимум один связующий</div>}</div><button className="primary wide" disabled={loading || !rolesReady} onClick={create}>Начать тестовый матч</button></>}
      <p className="privacy-note">Снимок и статистика сохраняются в отдельной тестовой таблице. Рабочие данные VSL не изменятся.</p>
    </section>
  </main>
}

function QuickCapture({ loaded, onReload, onHome }) {
  const { state, commands, meta } = loaded; const set = state.sets.at(-1); const [selected, setSelected] = useState(null); const [teamId, setTeamId] = useState(state.teams[0].id); const [save, setSave] = useState(loaded.sync?.ok === false ? 'server-error' : 'saved'); const [error, setError] = useState(''); const [view, setView] = useState('capture'); const [assistFor, setAssistFor] = useState(null); const [substitute, setSubstitute] = useState(false)
  const teamRoster = state.roster.filter(player => player.teamId === teamId && player.active); const lineupIds = set?.lineups?.[teamId] || []
  const currentLibero = teamRoster.find(player => lineupIds.includes(player.id) && player.matchRole === 'libero') || teamRoster.find(player => player.starter && player.matchRole === 'libero') || teamRoster.find(player => player.matchRole === 'libero')
  const courtPlayers = lineupIds.map(id => teamRoster.find(player => player.id === id)).filter(player => player && player.matchRole !== 'libero')
  for (const player of teamRoster.filter(candidate => candidate.matchRole !== 'libero' && candidate.starter)) if (courtPlayers.length < 6 && !courtPlayers.some(candidate => candidate.id === player.id)) courtPlayers.push(player)
  for (const player of teamRoster.filter(candidate => candidate.matchRole !== 'libero')) if (courtPlayers.length < 6 && !courtPlayers.some(candidate => candidate.id === player.id)) courtPlayers.push(player)
  const roster = [...courtPlayers.slice(0, 6), ...(currentLibero ? [currentLibero] : [])]; const mainIds = new Set(roster.map(player => player.id)); const benchRoster = teamRoster.filter(player => !mainIds.has(player.id))
  const selectedPlayer = state.roster.find(p => p.id === selected); const score = set?.score || {}
  const selectedTeam = state.teams.find(t => t.id === teamId); const opponentTeam = state.teams.find(t => t.id !== teamId)
  const assistCandidates = assistFor ? roster.filter(p => p.id !== state.events.find(e => e.id === assistFor)?.actorId).sort((a, b) => Number(b.matchRole === 'setter') - Number(a.matchRole === 'setter') || (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999)) : []

  async function issue(type, payload) {
    setSave('saving'); setError('')
    try { const next = await commitCommand(makeCommand(type, state.id, meta.revision, payload)); setSave(next.sync?.ok === false ? 'server-error' : 'saved'); setSelected(null); await onReload(next); return next }
    catch (e) { setSave('error'); setError(e.message); return null }
  }
  async function terminal(skill, result, winnerTeamId = teamId) {
    if (!selected && !['unknown'].includes(skill)) { setError('Сначала выберите игрока'); return }
    const beforeEvents = new Set(state.events.map(e => e.id)); const next = await issue(CommandType.RECORD_TERMINAL_ACTION, { actorId: selected, teamId, skill, result, winnerTeamId })
    if (next && skill === 'attack' && result === 'point') setAssistFor(next.state.events.find(e => !beforeEvents.has(e.id) && e.skill === 'attack')?.id || null)
  }
  async function undo() { const target = latestUndoable(commands); if (target) await issue(CommandType.UNDO, { targetCommandId: target.commandId }) }
  async function redo() { const target = latestRedoable(commands); if (target) await issue(CommandType.REDO, { targetCommandId: target.commandId }) }
  async function newSet() { await issue(CommandType.START_SET, { servingTeamId: state.teams[0].id, lineups: Object.fromEntries(state.teams.map(team => { const available = state.roster.filter(player => player.teamId === team.id && player.active && player.matchRole !== 'libero'); const starters = available.filter(player => player.starter); return [team.id, (starters.length === 6 ? starters : available.slice(0, 6)).map(player => player.id)] })) }) }
  async function enterLandscape() {
    if (!document.documentElement.requestFullscreen) return
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen() } catch { /* iOS Safari не поддерживает полноэкранный режим для обычной вкладки */ }
    try { await screen.orientation?.lock?.('landscape') } catch { /* В браузере остаётся подсказка повернуть телефон вручную */ }
  }

  if (view === 'report') return <Report state={state} onBack={() => setView('capture')} onJson={() => downloadJson(loaded)} onCsv={() => downloadCsv(state)}/>
  if (view === 'journal') return <Journal state={state} onBack={() => setView('capture')}/>
  return <main className="capture-page"><div className="orientation-gate"><b>Поверните телефон горизонтально</b><span>Экран матча работает как единый пульт без прокрутки.</span><button className="primary" onClick={enterLandscape}>Открыть на весь экран</button></div><header className="match-header"><button className="back" onClick={onHome}>← Матчи</button><div><span>Партия {set?.number}</span><h1>{state.meta.title}</h1></div><button className="fullscreen-toggle" aria-label="На весь экран" title="На весь экран" onClick={enterLandscape}>⛶</button><SaveMark status={save}/></header>
    <div className="scoreboard">{state.teams.map(t => <button key={t.id} className={`${teamId === t.id ? 'active' : ''} ${set?.servingTeamId === t.id ? 'serving' : ''}`} onClick={() => { setTeamId(t.id); setSelected(null) }}><span>{t.name}{set?.servingTeamId === t.id ? ' · подача' : ''}</span><b>{score[t.id] || 0}</b><em>R{(set?.rotations[t.id] || 0) + 1}</em></button>)}<div className="set-number">{state.sets.filter(s => s.status === 'completed').length}<small>партий завершено</small></div></div>
    {error && <div className="notice warn compact dismissible"><span>{error}</span><button type="button" aria-label="Закрыть сообщение" onClick={() => setError('')}>×</button></div>}
    <div className="capture-grid"><section className="players-panel"><div className="panel-title"><h2>На площадке · 6 + либеро</h2><span>{selectedTeam?.name}</span></div><div className="player-grid court-roster">{roster.map(p => <button key={p.id} className={`${selected === p.id ? 'selected' : ''} ${normalizeMatchRole(p.matchRole)}`} onClick={() => setSelected(p.id)}><strong>{p.jerseyNumber ?? '—'}</strong><span>{p.displayName}</span>{p.matchRole === 'libero' && <em className="libero">Л</em>}{p.matchRole === 'setter' && <em className="setter">СВ</em>}</button>)}</div>{benchRoster.length > 0 && <div className="bench-strip"><div className="bench-title"><b>Запасные</b><span>Нажмите игрока для замены</span></div><div className="bench-grid">{benchRoster.map(player => <button key={player.id} onClick={() => setSubstitute(player.id)}><strong>{player.jerseyNumber ?? '—'}</strong><span>{player.displayName}</span>{player.matchRole === 'libero' && <em>Л</em>}</button>)}</div></div>}</section>
      <section className="actions-panel"><div className="selected-player">{selectedPlayer ? <><strong>{playerLabel(selectedPlayer)}</strong><span>{selectedPlayer.matchRole === 'libero' ? 'Либеро: оцените действие' : 'Выберите результат'}</span></> : <><strong>Игрок не выбран</strong><span>Нажмите карточку слева</span></>}</div>
        {selectedPlayer?.matchRole === 'libero' ? <div className="libero-actions"><button className="positive" onClick={() => issue(CommandType.RECORD_LIBERO_ASSESSMENT, { rosterEntryId: selected, sign: 'positive' })}><b>+</b><span>Позитивное</span></button><button className="negative" onClick={() => issue(CommandType.RECORD_LIBERO_ASSESSMENT, { rosterEntryId: selected, sign: 'negative' })}><b>−</b><span>Негативное</span></button></div> : <div className="action-grid"><button onClick={() => terminal('serve','ace')}>🎯 <span>Эйс</span></button><button onClick={() => terminal('attack','point')}>⚡ <span>Атака: очко</span></button><button onClick={() => terminal('block','point')}>🛡 <span>Блок: очко</span></button><button className="error-action" onClick={() => terminal('serve','error', state.teams.find(t => t.id !== teamId).id)}>Подача: ошибка</button><button className="error-action" onClick={() => terminal('attack','error', state.teams.find(t => t.id !== teamId).id)}>Атака: ошибка</button></div>}
        <div className="unknown-actions"><button onClick={() => issue(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: selectedTeam.id })}>Очко {selectedTeam.name}</button><button onClick={() => issue(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: opponentTeam.id })}>Очко {opponentTeam.name}</button></div>
      </section>
      <aside className="side-panel"><h2>Последние события</h2><div className="mini-log">{state.events.slice(-7).reverse().map(e => { const p = state.roster.find(x => x.id === e.actorId); return <div key={e.id}><b>{p ? `№${p.jerseyNumber ?? '—'} ${p.displayName}` : e.skill}</b><span>{e.skill === 'libero' ? (e.result === 'positive' ? '+ позитивное' : '− негативное') : `${e.skill} · ${e.result}`}</span></div> })}</div></aside>
    </div>
    {assistFor && <div className="assist-drawer"><div><b>Кто отдал результативный пас?</b><span>Связующие выделены и показаны первыми. Очко уже записано.</span></div><div className="assist-players">{assistCandidates.map(p => <button key={p.id} className={p.matchRole === 'setter' ? 'setter-candidate' : ''} onClick={async () => { await issue(CommandType.ASSIGN_ASSIST, { attackEventId: assistFor, assisterId: p.id }); setAssistFor(null) }}>{p.matchRole === 'setter' && <small>СВ</small>} №{p.jerseyNumber ?? '—'} {p.displayName}</button>)}<button className="ghost" onClick={async () => { await issue(CommandType.ASSIGN_ASSIST, { attackEventId: assistFor, assisterId: null }); setAssistFor(null) }}>Без ассиста</button><button className="ghost" onClick={() => setAssistFor(null)}>Позже</button></div></div>}
    {substitute && <Substitution
      state={state}
      teamId={teamId}
      initialInId={typeof substitute === 'string' ? substitute : null}
      onClose={() => setSubstitute(false)}
      onApply={async (outId, inId) => {
        await issue(CommandType.SUBSTITUTE_PLAYER, { teamId, outId, inId })
        setSubstitute(false)
      }}
    />}
    <nav className="match-nav"><button disabled={!latestUndoable(commands)} onClick={undo}>↶ Отменить</button><button disabled={!latestRedoable(commands)} onClick={redo}>↷ Повторить</button><button onClick={() => setSubstitute(true)}>⇄ Замена</button><button onClick={() => setView('journal')}>Журнал</button><button onClick={() => setView('report')}>Отчёт</button>{set?.status === 'in_progress' ? <button onClick={() => issue(CommandType.FINISH_SET,{})}>Завершить партию</button> : state.status !== 'completed' ? <><button className="primary" onClick={newSet}>Новая партия</button><button onClick={() => issue(CommandType.FINISH_MATCH,{})}>Завершить матч</button></> : null}</nav>
  </main>
}

function activeRosterFor(state, set, teamId) {
  const teamRoster = state.roster.filter(player => player.teamId === teamId && player.active); const lineupIds = set?.lineups?.[teamId] || []
  const libero = teamRoster.find(player => lineupIds.includes(player.id) && player.matchRole === 'libero') || teamRoster.find(player => player.starter && player.matchRole === 'libero') || teamRoster.find(player => player.matchRole === 'libero')
  const court = lineupIds.map(id => teamRoster.find(player => player.id === id)).filter(player => player && player.matchRole !== 'libero')
  for (const player of teamRoster.filter(candidate => candidate.matchRole !== 'libero' && candidate.starter)) if (court.length < 6 && !court.some(candidate => candidate.id === player.id)) court.push(player)
  for (const player of teamRoster.filter(candidate => candidate.matchRole !== 'libero')) if (court.length < 6 && !court.some(candidate => candidate.id === player.id)) court.push(player)
  const main = [...court.slice(0, 6), ...(libero ? [libero] : [])]; const ids = new Set(main.map(player => player.id))
  return { main, bench: teamRoster.filter(player => !ids.has(player.id)) }
}

function DetailedCapture({ loaded, onReload, onHome }) {
  const { state, commands, meta } = loaded; const set = state.sets.at(-1)
  const [selected, setSelected] = useState(null); const [teamId, setTeamId] = useState(state.teams[0].id); const [skill, setSkill] = useState('serve'); const [save, setSave] = useState(loaded.sync?.ok === false ? 'server-error' : 'saved'); const [error, setError] = useState(''); const [view, setView] = useState('capture'); const [substitute, setSubstitute] = useState(false)
  const { main: roster, bench: benchRoster } = activeRosterFor(state, set, teamId); const selectedPlayer = state.roster.find(player => player.id === selected); const score = set?.score || {}; const selectedTeam = state.teams.find(team => team.id === teamId); const opponentTeam = state.teams.find(team => team.id !== teamId)
  const currentRally = (set?.rallies.length || 0) + 1; const sequence = state.events.filter(event => !event.voided && event.setId === set?.id && event.rallyNumber === currentRally && !['substitution', 'libero-replacement'].includes(event.skill))
  async function issue(type, payload) { setSave('saving'); setError(''); try { const next = await commitCommand(makeCommand(type, state.id, meta.revision, payload)); setSave(next.sync?.ok === false ? 'server-error' : 'saved'); setSelected(null); await onReload(next); return next } catch (e) { setSave('error'); setError(e.message); return null } }
  async function record(result) { if (!selected) { setError('Сначала выберите игрока'); return } await issue(CommandType.RECORD_DETAILED_ACTION, { actorId: selected, teamId, skill, result }) }
  async function undo() { const target = latestUndoable(commands); if (target) await issue(CommandType.UNDO, { targetCommandId: target.commandId }) }
  async function redo() { const target = latestRedoable(commands); if (target) await issue(CommandType.REDO, { targetCommandId: target.commandId }) }
  async function newSet() { await issue(CommandType.START_SET, { servingTeamId: state.teams[0].id, lineups: Object.fromEntries(state.teams.map(team => { const available = state.roster.filter(player => player.teamId === team.id && player.active && player.matchRole !== 'libero'); const starters = available.filter(player => player.starter); return [team.id, (starters.length === 6 ? starters : available.slice(0, 6)).map(player => player.id)] })) }) }
  async function enterLandscape() { try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen() } catch { /* iOS */ } try { await screen.orientation?.lock?.('landscape') } catch { /* manual rotation */ } }
  if (view === 'report') return <Report state={state} onBack={() => setView('capture')} onJson={() => downloadJson(loaded)} onCsv={() => downloadCsv(state)}/>
  if (view === 'journal') return <Journal state={state} onBack={() => setView('capture')}/>
  return <main className="capture-page detailed-capture"><div className="orientation-gate"><b>Поверните телефон горизонтально</b><span>Экран матча работает как единый пульт без прокрутки.</span><button className="primary" onClick={enterLandscape}>Открыть на весь экран</button></div><header className="match-header"><button className="back" onClick={onHome}>← Матчи</button><div><span>Партия {set?.number} · подробная статистика</span><h1>{state.meta.title}</h1></div><button className="fullscreen-toggle" aria-label="На весь экран" onClick={enterLandscape}>⛶</button><SaveMark status={save}/></header>
    <div className="scoreboard">{state.teams.map(team => <button key={team.id} className={`${teamId === team.id ? 'active' : ''} ${set?.servingTeamId === team.id ? 'serving' : ''}`} onClick={() => { setTeamId(team.id); setSelected(null) }}><span>{team.name}{set?.servingTeamId === team.id ? ' · подача' : ''}</span><b>{score[team.id] || 0}</b><em>R{(set?.rotations[team.id] || 0) + 1}</em></button>)}</div>
    {error && <div className="notice warn compact dismissible"><span>{error}</span><button type="button" onClick={() => setError('')}>×</button></div>}
    <div className="capture-grid"><section className="players-panel"><div className="panel-title"><h2>На площадке · 6 + либеро</h2><span>{selectedTeam?.name}</span></div><div className="player-grid court-roster">{roster.map(player => <button key={player.id} className={`${selected === player.id ? 'selected' : ''} ${normalizeMatchRole(player.matchRole)}`} onClick={() => setSelected(player.id)}><strong>{player.jerseyNumber ?? '—'}</strong><span>{player.displayName}</span>{player.matchRole === 'libero' && <em className="libero">Л</em>}{player.matchRole === 'setter' && <em className="setter">СВ</em>}</button>)}</div>{benchRoster.length > 0 && <div className="bench-strip"><div className="bench-title"><b>Запасные</b><span>Нажмите для замены</span></div><div className="bench-grid">{benchRoster.map(player => <button key={player.id} onClick={() => setSubstitute(player.id)}><strong>{player.jerseyNumber ?? '—'}</strong><span>{player.displayName}</span></button>)}</div></div>}</section>
      <section className="actions-panel detailed-actions-panel"><div className="skill-tabs">{Object.keys(detailedActions).map(key => <button key={key} className={skill === key ? 'active' : ''} onClick={() => setSkill(key)}>{skillLabels[key]}</button>)}</div><div className="selected-player">{selectedPlayer ? <><strong>{playerLabel(selectedPlayer)}</strong><span>{skillLabels[skill]} · выберите результат</span></> : <><strong>Игрок не выбран</strong><span>Выберите игрока слева, затем результат</span></>}</div><div className={`detail-action-grid ${skill}`}>{detailedActions[skill].map(action => <button key={action.result} className={`${action.terminal === 'own' ? 'point-action' : ''} ${action.terminal === 'opponent' ? 'error-action' : ''}`} onClick={() => record(action.result)}><b>{action.label}</b><small>{action.terminal === 'own' ? `+1 ${selectedTeam?.name}` : action.terminal === 'opponent' ? `+1 ${opponentTeam?.name}` : 'розыгрыш продолжается'}</small></button>)}</div><div className="current-sequence"><b>Розыгрыш {currentRally}</b><span>{sequence.length ? sequence.map(event => `${skillLabels[event.skill]}: ${detailedActions[event.skill]?.find(item => item.result === event.result)?.label || event.result}`).join(' → ') : 'пока нет действий'}</span></div><div className="unknown-actions"><button onClick={() => issue(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: selectedTeam.id })}>Очко {selectedTeam.name}</button><button onClick={() => issue(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: opponentTeam.id })}>Очко {opponentTeam.name}</button></div></section>
    </div>
    {substitute && <Substitution state={state} teamId={teamId} initialInId={typeof substitute === 'string' ? substitute : null} onClose={() => setSubstitute(false)} onApply={async (outId, inId) => { await issue(CommandType.SUBSTITUTE_PLAYER, { teamId, outId, inId }); setSubstitute(false) }}/>}<nav className="match-nav"><button disabled={!latestUndoable(commands)} onClick={undo}>↶ Отменить</button><button disabled={!latestRedoable(commands)} onClick={redo}>↷ Повторить</button><button onClick={() => setSubstitute(true)}>⇄ Замена</button><button onClick={() => setView('journal')}>Журнал</button><button onClick={() => setView('report')}>Отчёт</button>{set?.status === 'in_progress' ? <button onClick={() => issue(CommandType.FINISH_SET,{})}>Завершить партию</button> : state.status !== 'completed' ? <><button className="primary" onClick={newSet}>Новая партия</button><button onClick={() => issue(CommandType.FINISH_MATCH,{})}>Завершить матч</button></> : null}</nav>
  </main>
}

function Capture(props) { return props.loaded.state.meta.statsMode === 'detailed' ? <DetailedCapture {...props}/> : <QuickCapture {...props}/> }

function Substitution({ state, teamId, initialInId, onClose, onApply }) {
  const set = state.sets.at(-1); const lineup = (set.lineups[teamId] || []).filter(id => state.roster.find(player => player.id === id)?.matchRole !== 'libero'); const [outId,setOut] = useState(lineup[0] || ''); const bench = state.roster.filter(player => player.teamId === teamId && player.active && player.matchRole !== 'libero' && !lineup.includes(player.id)); const [inId,setIn] = useState(bench.some(player => player.id === initialInId) ? initialInId : bench[0]?.id || '')
  return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e => e.stopPropagation()}><h2>Замена полевого игрока</h2><label>Уходит с площадки<select value={outId} onChange={e=>setOut(e.target.value)}>{lineup.map(id => { const p=state.roster.find(x=>x.id===id); return <option key={id} value={id}>{playerLabel(p)}</option> })}</select></label><label>Выходит из запаса<select value={inId} onChange={e=>setIn(e.target.value)}>{bench.map(p=><option key={p.id} value={p.id}>{playerLabel(p)}</option>)}</select></label><div className="modal-actions"><button className="ghost" onClick={onClose}>Отмена</button><button className="primary" disabled={!inId || !outId} onClick={()=>onApply(outId,inId)}>Применить</button></div></div></div>
}

function Journal({ state, onBack }) { const rows = buildJournalRows(state); return <main className="page"><button className="back" onClick={onBack}>← К матчу</button><div className="title"><p className="eyebrow">Проверка записи</p><h1>Журнал розыгрышей</h1><p className="journal-help">Каждая строка показывает счёт после розыгрыша, автора очка и результативный пас.</p></div><div className="journal">{rows.length ? rows.map(row => <article key={row.id}><div className="journal-rally"><strong>Партия {row.setNumber} · розыгрыш {row.number}</strong><span>{row.scoreWithTeams}</span></div><div className="journal-winner"><small>Розыгрыш взяла</small><b>{row.winnerName}</b><em>{row.scoreLabel}</em></div><div className="journal-action">{row.actionLines.map((line, index) => <span key={index}>{line}</span>)}{row.administrative && <small>Административное очко</small>}</div></article>) : <div className="empty">Розыгрышей пока нет.</div>}</div></main> }

function Report({ state, onBack, onJson, onCsv }) {
  const rows = calculateStats(state); const detailed = state.meta.statsMode === 'detailed'; const values = (row, skill, keys) => keys.map(key => row.detailed[skill][key]).join(' / ')
  return <main className="page"><button className="back" onClick={onBack}>← К матчу</button><div className="title report-title"><div><p className="eyebrow">{detailed ? 'Подробный отчёт' : 'Локальный отчёт'}</p><h1>{state.meta.title}</h1></div><div><button className="ghost" onClick={onJson}>JSON-копия</button><button className="ghost" onClick={onCsv}>CSV</button></div></div>{detailed ? <div className="report-table detailed-report"><div className="report-row header"><span>Игрок</span><span>Подача<br/>Э/У/Н/О</span><span>Приём<br/>0/1/2/3</span><span>Пас<br/>О/А/Р/И</span><span>Атака<br/>О/У/И/Б+/Б−/Ош</span><span>Блок<br/>О/С/Соп/Аут/Ош</span></div>{rows.map(row => <div className="report-row" key={row.playerId}><span><b>№{row.number ?? '—'}</b> {row.name}</span><span>{values(row, 'serve', ['ace','pressure','normal','error'])}</span><span>{values(row, 'reception', ['error','shanked','normal','ideal'])}</span><span>{values(row, 'set', ['error','emergency','workable','ideal'])}</span><span>{values(row, 'attack', ['point','pressure','in_play','block_covered','blocked_point','error'])}</span><span>{values(row, 'block', ['point','softened','to_opponent','block_out','error'])}</span></div>)}{!rows.length && <div className="empty">Показателей пока нет.</div>}</div> : <><div className="report-table"><div className="report-row header"><span>Игрок</span><span>Атака</span><span>Эйсы</span><span>Пасы</span><span>Блок</span><span>Либеро +/−</span></div>{rows.map(row => <div className="report-row" key={row.playerId}><span><b>№{row.number??'—'}</b> {row.name}</span><span>{row.attackPoints}</span><span>{row.aces}</span><span>{row.assists}</span><span>{row.blockPoints}</span><span className={row.liberoBalance>=0?'good':'bad'}>{row.liberoPositive}/{row.liberoNegative} ({row.liberoBalance>=0?'+':''}{row.liberoBalance})</span></div>)}{!rows.length&&<div className="empty">Показателей пока нет.</div>}</div><p className="footnote">Плюсы и минусы либеро — субъективные отметки оператора. Они не являются процентом приёма.</p></>}</main>
}

export default function App() {
  const [screen,setScreen]=useState('home'); const [matches,setMatches]=useState([]); const [loaded,setLoaded]=useState(null); const [fatal,setFatal]=useState('')
  async function refreshList(){ setMatches(await listLocalMatches()) }
  useEffect(()=>{ refreshList().catch(e=>setFatal(e.message)) },[])
  async function open(id){ const match=await loadMatch(id); if(match){setLoaded(match);setScreen('capture')} }
  async function reload(next){ const value=next||await loadMatch(loaded.state.id); setLoaded(value); await refreshList() }
  async function remove(id){ if(!confirm('Удалить тестовый матч с сервера и этого устройства? Сначала сохраните JSON-копию, если она нужна.'))return; await deleteLocalMatch(id); await refreshList() }
  async function importFile(e){ const file=e.target.files?.[0]; if(!file)return; try{const text=await file.text(); const bundle=validateBundle(JSON.parse(text),file.size); const value=await importMatchBundle(bundle); await refreshList();setLoaded(value);setScreen('capture')}catch(error){setFatal(error.message)}finally{e.target.value=''} }
  return <><UpdateBanner matchActive={screen==='capture'&&loaded?.state.status==='in_progress'}/>{fatal&&<div className="fatal"><span>{fatal}</span><button onClick={()=>setFatal('')}>×</button></div>}{screen==='home'&&<Home matches={matches} onNew={()=>setScreen('prepare')} onOpen={open} onImport={importFile} onDelete={remove}/>} {screen==='prepare'&&<Prepare onCancel={()=>setScreen('home')} onCreated={value=>{setLoaded(value);setScreen('capture')}}/>}{screen==='capture'&&loaded&&<Capture loaded={loaded} onReload={reload} onHome={async()=>{await refreshList();setScreen('home')}}/>}</>
}
