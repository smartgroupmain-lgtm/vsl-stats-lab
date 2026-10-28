import { useEffect, useRef, useState } from 'react'
import { config } from './config.js'
import LabBanner from './components/LabBanner.jsx'
import UpdateBanner from './components/UpdateBanner.jsx'
import { createReadOnlyTransport } from './lib/source/readonlyTransport.js'
import { createCatalogReader, mapRoster } from './lib/source/vslCatalogReader.js'
import { demoCatalog, demoRoster } from './lib/source/demoCatalog.js'
import { cacheCatalog, readCatalog } from './lib/storage/catalogRepository.js'
import { commitCommand, deleteLocalMatch, importMatchBundle, listLocalMatches, loadMatch } from './lib/storage/matchRepository.js'
import { CommandType, makeCommand } from './lib/match-engine/commands.js'
import { calculateStats } from './lib/match-engine/statistics.js'
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

function RoleRoster({ roster, team, onRoleChange }) {
  const activeRoster = roster.filter(p => p.active)
  return <div className="role-team"><div className="role-team-head"><h3>{team.name}</h3><span>{activeRoster.filter(p => p.matchRole === 'setter').length} связ. · {activeRoster.filter(p => p.matchRole === 'libero').length} либеро</span></div><div className="role-roster">{activeRoster.map(p => <label key={p.id} className={`role-player ${p.matchRole}`}><span><b>№{p.jerseyNumber ?? '—'}</b> {p.displayName}</span><select aria-label={`Роль ${p.displayName}`} value={p.matchRole} onChange={e => onRoleChange(p.id, e.target.value)}><option value="player">Игрок</option><option value="setter">Связующий</option><option value="libero">Либеро</option></select></label>)}</div></div>
}

function Prepare({ onCancel, onCreated }) {
  const [mode, setMode] = useState(sourceReader ? 'source' : 'demo')
  const [leagues, setLeagues] = useState([]); const [seasons, setSeasons] = useState([]); const [teams, setTeams] = useState([])
  const [league, setLeague] = useState(''); const [season, setSeason] = useState(''); const [teamA, setTeamA] = useState(''); const [teamB, setTeamB] = useState('')
  const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const [serving, setServing] = useState('A')
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
      const rosterA = (mode === 'demo' ? rawA : mapRoster(rawA, { teamId: teamA, seasonId: season, teamSnapshotId: aSnapshot })).map(p => ({ ...p, matchRole: normalizeMatchRole(p.matchRole) }))
      const rosterB = (mode === 'demo' ? rawB : mapRoster(rawB, { teamId: teamB, seasonId: season, teamSnapshotId: bSnapshot })).map(p => ({ ...p, matchRole: normalizeMatchRole(p.matchRole) }))
      if (!rosterA.length || !rosterB.length) throw new Error('В одной из команд нет доступного состава')
      const teamsLocal = [{ id: aSnapshot, sourceTeamId: teamA, name: teamLabel(teams.find(t => t.id === teamA)) }, { id: bSnapshot, sourceTeamId: teamB, name: teamLabel(teams.find(t => t.id === teamB)) }]
      setPrepared({ matchId, aSnapshot, bSnapshot, teamsLocal, rosterA, rosterB })
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  function updateRole(rosterKey, playerId, matchRole) {
    setPrepared(current => ({ ...current, [rosterKey]: current[rosterKey].map(p => p.id === playerId ? { ...p, matchRole } : p) }))
  }
  async function create() {
    if (!prepared) return
    const { matchId, aSnapshot, bSnapshot, teamsLocal, rosterA, rosterB } = prepared
    const selectedA = rosterA.filter(p => p.active).slice(0, 6); const selectedB = rosterB.filter(p => p.active).slice(0, 6)
    if (selectedA.length < 6 || selectedB.length < 6) { setError('Для старта нужно минимум 6 активных игроков в каждой команде'); return }
    if (!rosterA.some(p => p.active && p.matchRole === 'setter') || !rosterB.some(p => p.active && p.matchRole === 'setter')) { setError('Отметьте минимум одного связующего в каждой команде'); return }
    setLoading(true); setError('')
    try {
      let loaded = await commitCommand(makeCommand(CommandType.CREATE_MATCH, matchId, 0, { meta: { title: `${teamsLocal[0].name} — ${teamsLocal[1].name}`, sourceLeague: league, sourceSeasonId: season, environment: 'lab' }, rules: { setsToWin: 3, regularTarget: 25, decidingTarget: 15, advantage: 2 }, teams: teamsLocal, roster: [...rosterA, ...rosterB] }))
      loaded = await commitCommand(makeCommand(CommandType.START_SET, matchId, loaded.meta.revision, { servingTeamId: serving === 'A' ? aSnapshot : bSnapshot, lineups: { [aSnapshot]: selectedA.map(p => p.id), [bSnapshot]: selectedB.map(p => p.id) } }))
      onCreated(loaded)
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }
  const rolesReady = prepared && prepared.rosterA.some(p => p.active && p.matchRole === 'setter') && prepared.rosterB.some(p => p.active && p.matchRole === 'setter')
  return <main className="page narrow"><button className="back" onClick={onCancel}>← К матчам</button><div className="title"><p className="eyebrow">Подготовка</p><h1>Новый тестовый матч</h1></div>
    <div className="mode-tabs"><button className={mode === 'source' ? 'active' : ''} disabled={!sourceReader} onClick={() => { setPrepared(null); setMode('source') }}>Данные VSL</button><button className={mode === 'demo' ? 'active' : ''} onClick={() => { setPrepared(null); setMode('demo') }}>Деморежим</button></div>
    {loading && <Spinner/>}{error && <div className="notice warn">{error}</div>}
    <section className="form-card"><label>Лига<select value={league} onChange={e => { setPrepared(null); setLeague(e.target.value) }}>{leagues.map(l => <option key={l.id} value={l.name}>{l.display_name}</option>)}</select></label><label>Сезон<select value={season} onChange={e => { setPrepared(null); setSeason(e.target.value) }}>{seasons.map(s => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' · текущий' : ''}</option>)}</select></label>
      <div className="versus"><label>Команда 1<select value={teamA} onChange={e => { setPrepared(null); setTeamA(e.target.value) }}>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><b>VS</b><label>Команда 2<select value={teamB} onChange={e => { setPrepared(null); setTeamB(e.target.value) }}>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
      <fieldset><legend>Кто подаёт первым</legend><label className="radio"><input type="radio" checked={serving === 'A'} onChange={() => setServing('A')}/>{teams.find(t => t.id === teamA)?.name || 'Команда 1'}</label><label className="radio"><input type="radio" checked={serving === 'B'} onChange={() => setServing('B')}/>{teams.find(t => t.id === teamB)?.name || 'Команда 2'}</label></fieldset>
      {!prepared ? <button className="primary wide" disabled={loading || !teams.length} onClick={prepareRosters}>Загрузить составы и роли</button> : <><div className="role-review"><div className="role-review-head"><div><p className="eyebrow">Обязательный шаг</p><h2>Проверьте игровые роли</h2></div><button className="ghost" onClick={prepareRosters}>Обновить составы</button></div><p>Отметьте минимум одного связующего в каждой команде. Связующие будут первыми в выборе результативного паса. Роли сохранятся только в этом тестовом матче.</p><RoleRoster roster={prepared.rosterA} team={prepared.teamsLocal[0]} onRoleChange={(playerId, role) => updateRole('rosterA', playerId, role)}/><RoleRoster roster={prepared.rosterB} team={prepared.teamsLocal[1]} onRoleChange={(playerId, role) => updateRole('rosterB', playerId, role)}/>{!rolesReady && <div className="role-required">Нужно выбрать связующего в каждой команде</div>}</div><button className="primary wide" disabled={loading || !rolesReady} onClick={create}>Начать тестовый матч</button></>}
      <p className="privacy-note">Снимок и статистика сохраняются в отдельной тестовой таблице. Рабочие данные VSL не изменятся.</p>
    </section>
  </main>
}

function Capture({ loaded, onReload, onHome }) {
  const { state, commands, meta } = loaded; const set = state.sets.at(-1); const [selected, setSelected] = useState(null); const [teamId, setTeamId] = useState(state.teams[0].id); const [save, setSave] = useState(loaded.sync?.ok === false ? 'server-error' : 'saved'); const [error, setError] = useState(''); const [view, setView] = useState('capture'); const [assistFor, setAssistFor] = useState(null); const [substitute, setSubstitute] = useState(false)
  const roster = state.roster.filter(p => p.teamId === teamId && p.active); const selectedPlayer = state.roster.find(p => p.id === selected); const score = set?.score || {}
  const selectedTeam = state.teams.find(t => t.id === teamId); const opponentTeam = state.teams.find(t => t.id !== teamId)
  const assistCandidates = assistFor ? roster.filter(p => p.id !== state.events.find(e => e.id === assistFor)?.actorId).sort((a, b) => Number(b.matchRole === 'setter') - Number(a.matchRole === 'setter') || (a.jerseyNumber ?? 999) - (b.jerseyNumber ?? 999)) : []

  async function issue(type, payload) {
    setSave('saving'); setError('')
    try { const next = await commitCommand(makeCommand(type, state.id, meta.revision, payload)); setSave(next.sync?.ok === false ? 'server-error' : 'saved'); if (next.sync?.ok === false) setError(next.sync.error); setSelected(null); await onReload(next); return next }
    catch (e) { setSave('error'); setError(e.message); return null }
  }
  async function terminal(skill, result, winnerTeamId = teamId) {
    if (!selected && !['unknown'].includes(skill)) { setError('Сначала выберите игрока'); return }
    const beforeEvents = new Set(state.events.map(e => e.id)); const next = await issue(CommandType.RECORD_TERMINAL_ACTION, { actorId: selected, teamId, skill, result, winnerTeamId })
    if (next && skill === 'attack' && result === 'point') setAssistFor(next.state.events.find(e => !beforeEvents.has(e.id) && e.skill === 'attack')?.id || null)
  }
  async function undo() { const target = latestUndoable(commands); if (target) await issue(CommandType.UNDO, { targetCommandId: target.commandId }) }
  async function redo() { const target = latestRedoable(commands); if (target) await issue(CommandType.REDO, { targetCommandId: target.commandId }) }
  async function newSet() { await issue(CommandType.START_SET, { servingTeamId: state.teams[0].id, lineups: Object.fromEntries(state.teams.map(t => [t.id, state.roster.filter(p => p.teamId === t.id && p.active).slice(0,6).map(p => p.id)])) }) }
  async function enterLandscape() {
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen() } catch { /* iOS Safari не поддерживает полноэкранный запрос для обычной страницы */ }
    try { await screen.orientation?.lock?.('landscape') } catch { /* В браузере остаётся подсказка повернуть телефон вручную */ }
  }

  if (view === 'report') return <Report state={state} onBack={() => setView('capture')} onJson={() => downloadJson(loaded)} onCsv={() => downloadCsv(state)}/>
  if (view === 'journal') return <Journal state={state} onBack={() => setView('capture')}/>
  return <main className="capture-page"><div className="orientation-gate"><b>Поверните телефон горизонтально</b><span>Экран матча работает как единый пульт без прокрутки.</span><button className="primary" onClick={enterLandscape}>Открыть на весь экран</button></div><header className="match-header"><button className="back" onClick={onHome}>← Матчи</button><div><span>Партия {set?.number}</span><h1>{state.meta.title}</h1></div><SaveMark status={save}/></header>
    <div className="scoreboard">{state.teams.map(t => <button key={t.id} className={`${teamId === t.id ? 'active' : ''} ${set?.servingTeamId === t.id ? 'serving' : ''}`} onClick={() => { setTeamId(t.id); setSelected(null) }}><span>{t.name}{set?.servingTeamId === t.id ? ' · подача' : ''}</span><b>{score[t.id] || 0}</b><em>R{(set?.rotations[t.id] || 0) + 1}</em></button>)}<div className="set-number">{state.sets.filter(s => s.status === 'completed').length}<small>партий завершено</small></div></div>
    {error && <div className="notice warn compact">{error}</div>}
    <div className="capture-grid"><section className="players-panel"><div className="panel-title"><h2>Игрок</h2><span>{selectedTeam?.name}</span></div><div className="player-grid">{roster.map(p => <button key={p.id} className={`${selected === p.id ? 'selected' : ''} ${normalizeMatchRole(p.matchRole)}`} onClick={() => setSelected(p.id)}><strong>{p.jerseyNumber ?? '—'}</strong><span>{p.displayName}</span>{p.matchRole === 'libero' && <em className="libero">Л</em>}{p.matchRole === 'setter' && <em className="setter">СВ</em>}</button>)}</div></section>
      <section className="actions-panel"><div className="selected-player">{selectedPlayer ? <><strong>{playerLabel(selectedPlayer)}</strong><span>{selectedPlayer.matchRole === 'libero' ? 'Либеро: оцените действие' : 'Выберите результат'}</span></> : <><strong>Игрок не выбран</strong><span>Нажмите карточку слева</span></>}</div>
        {selectedPlayer?.matchRole === 'libero' ? <div className="libero-actions"><button className="positive" onClick={() => issue(CommandType.RECORD_LIBERO_ASSESSMENT, { rosterEntryId: selected, sign: 'positive' })}><b>+</b><span>Позитивное</span></button><button className="negative" onClick={() => issue(CommandType.RECORD_LIBERO_ASSESSMENT, { rosterEntryId: selected, sign: 'negative' })}><b>−</b><span>Негативное</span></button></div> : <div className="action-grid"><button onClick={() => terminal('serve','ace')}>🎯 <span>Эйс</span></button><button onClick={() => terminal('attack','point')}>⚡ <span>Атака: очко</span></button><button onClick={() => terminal('block','point')}>🛡 <span>Блок: очко</span></button><button className="error-action" onClick={() => terminal('serve','error', state.teams.find(t => t.id !== teamId).id)}>Подача: ошибка</button><button className="error-action" onClick={() => terminal('attack','error', state.teams.find(t => t.id !== teamId).id)}>Атака: ошибка</button></div>}
        <div className="unknown-actions"><button onClick={() => issue(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: selectedTeam.id })}>Очко {selectedTeam.name}</button><button onClick={() => issue(CommandType.RECORD_UNKNOWN_POINT, { winnerTeamId: opponentTeam.id })}>Очко {opponentTeam.name}</button></div>
      </section>
      <aside className="side-panel"><h2>Последние события</h2><div className="mini-log">{state.events.slice(-7).reverse().map(e => { const p = state.roster.find(x => x.id === e.actorId); return <div key={e.id}><b>{p ? `№${p.jerseyNumber ?? '—'} ${p.displayName}` : e.skill}</b><span>{e.skill === 'libero' ? (e.result === 'positive' ? '+ позитивное' : '− негативное') : `${e.skill} · ${e.result}`}</span></div> })}</div></aside>
    </div>
    {assistFor && <div className="assist-drawer"><div><b>Кто отдал результативный пас?</b><span>Связующие выделены и показаны первыми. Очко уже записано.</span></div><div className="assist-players">{assistCandidates.map(p => <button key={p.id} className={p.matchRole === 'setter' ? 'setter-candidate' : ''} onClick={async () => { await issue(CommandType.ASSIGN_ASSIST, { attackEventId: assistFor, assisterId: p.id }); setAssistFor(null) }}>{p.matchRole === 'setter' && <small>СВ</small>} №{p.jerseyNumber ?? '—'} {p.displayName}</button>)}<button className="ghost" onClick={async () => { await issue(CommandType.ASSIGN_ASSIST, { attackEventId: assistFor, assisterId: null }); setAssistFor(null) }}>Без ассиста</button><button className="ghost" onClick={() => setAssistFor(null)}>Позже</button></div></div>}
    {substitute && <Substitution state={state} teamId={teamId} onClose={() => setSubstitute(false)} onApply={async (outId,inId,isLibero) => { await issue(isLibero ? CommandType.REPLACE_LIBERO : CommandType.SUBSTITUTE_PLAYER,{ teamId,outId,inId }); setSubstitute(false) }}/>} 
    <nav className="match-nav"><button disabled={!latestUndoable(commands)} onClick={undo}>↶ Отменить</button><button disabled={!latestRedoable(commands)} onClick={redo}>↷ Повторить</button><button onClick={() => setSubstitute(true)}>⇄ Замена</button><button onClick={() => setView('journal')}>Журнал</button><button onClick={() => setView('report')}>Отчёт</button>{set?.status === 'in_progress' ? <button onClick={() => issue(CommandType.FINISH_SET,{})}>Завершить партию</button> : state.status !== 'completed' ? <><button className="primary" onClick={newSet}>Новая партия</button><button onClick={() => issue(CommandType.FINISH_MATCH,{})}>Завершить матч</button></> : null}</nav>
  </main>
}

function Substitution({ state, teamId, onClose, onApply }) {
  const set = state.sets.at(-1); const lineup = set.lineups[teamId] || []; const [outId,setOut] = useState(lineup[0] || ''); const bench = state.roster.filter(p => p.teamId === teamId && p.active && !lineup.includes(p.id)); const [inId,setIn] = useState(bench[0]?.id || '')
  const incoming = state.roster.find(p => p.id === inId)
  return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e => e.stopPropagation()}><h2>Замена</h2><label>Уходит<select value={outId} onChange={e=>setOut(e.target.value)}>{lineup.map(id => { const p=state.roster.find(x=>x.id===id); return <option key={id} value={id}>{playerLabel(p)}</option> })}</select></label><label>Выходит<select value={inId} onChange={e=>setIn(e.target.value)}>{bench.map(p=><option key={p.id} value={p.id}>{playerLabel(p)}</option>)}</select></label><div className="modal-actions"><button className="ghost" onClick={onClose}>Отмена</button><button className="primary" disabled={!inId} onClick={()=>onApply(outId,inId,incoming?.matchRole==='libero')}>Применить</button></div></div></div>
}

function Journal({ state, onBack }) { const rallies = state.sets.flatMap(s => s.rallies.map(r => ({...r,setNumber:s.number}))).reverse(); return <main className="page"><button className="back" onClick={onBack}>← К матчу</button><div className="title"><p className="eyebrow">Аудит</p><h1>Журнал розыгрышей</h1></div><div className="journal">{rallies.length ? rallies.map(r => <article key={r.id}><strong>Партия {r.setNumber} · розыгрыш {r.number}</strong><b>{state.teams.find(t=>t.id===r.winnerTeamId)?.name}</b><span>{r.reason}{r.administrative?' · административное':''}</span></article>) : <div className="empty">Розыгрышей пока нет.</div>}</div></main> }

function Report({ state, onBack, onJson, onCsv }) { const rows=calculateStats(state); return <main className="page"><button className="back" onClick={onBack}>← К матчу</button><div className="title report-title"><div><p className="eyebrow">Локальный отчёт</p><h1>{state.meta.title}</h1></div><div><button className="ghost" onClick={onJson}>JSON-копия</button><button className="ghost" onClick={onCsv}>CSV</button></div></div><div className="report-table"><div className="report-row header"><span>Игрок</span><span>Атака</span><span>Эйсы</span><span>Пасы</span><span>Блок</span><span>Либеро +/−</span></div>{rows.map(r=><div className="report-row" key={r.playerId}><span><b>№{r.number??'—'}</b> {r.name}</span><span>{r.attackPoints}</span><span>{r.aces}</span><span>{r.assists}</span><span>{r.blockPoints}</span><span className={r.liberoBalance>=0?'good':'bad'}>{r.liberoPositive}/{r.liberoNegative} ({r.liberoBalance>=0?'+':''}{r.liberoBalance})</span></div>)}{!rows.length&&<div className="empty">Показателей пока нет.</div>}</div><p className="footnote">Плюсы и минусы либеро — субъективные отметки оператора. Они не являются процентом приёма.</p></main> }

export default function App() {
  const [screen,setScreen]=useState('home'); const [matches,setMatches]=useState([]); const [loaded,setLoaded]=useState(null); const [fatal,setFatal]=useState('')
  async function refreshList(){ setMatches(await listLocalMatches()) }
  useEffect(()=>{ refreshList().catch(e=>setFatal(e.message)) },[])
  async function open(id){ const match=await loadMatch(id); if(match){setLoaded(match);setScreen('capture')} }
  async function reload(next){ const value=next||await loadMatch(loaded.state.id); setLoaded(value); await refreshList() }
  async function remove(id){ if(!confirm('Удалить тестовый матч с сервера и этого устройства? Сначала сохраните JSON-копию, если она нужна.'))return; await deleteLocalMatch(id); await refreshList() }
  async function importFile(e){ const file=e.target.files?.[0]; if(!file)return; try{const text=await file.text(); const bundle=validateBundle(JSON.parse(text),file.size); const value=await importMatchBundle(bundle); await refreshList();setLoaded(value);setScreen('capture')}catch(error){setFatal(error.message)}finally{e.target.value=''} }
  return <><LabBanner/><UpdateBanner matchActive={screen==='capture'&&loaded?.state.status==='in_progress'}/>{fatal&&<div className="fatal"><span>{fatal}</span><button onClick={()=>setFatal('')}>×</button></div>}{screen==='home'&&<Home matches={matches} onNew={()=>setScreen('prepare')} onOpen={open} onImport={importFile} onDelete={remove}/>} {screen==='prepare'&&<Prepare onCancel={()=>setScreen('home')} onCreated={value=>{setLoaded(value);setScreen('capture')}}/>}{screen==='capture'&&loaded&&<Capture loaded={loaded} onReload={reload} onHome={async()=>{await refreshList();setScreen('home')}}/>}</>
}
