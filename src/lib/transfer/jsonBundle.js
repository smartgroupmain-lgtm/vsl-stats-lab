const MAX_BYTES = 10 * 1024 * 1024
const MAX_COMMANDS = 100000

export function makeBundle(loaded) {
  return { format: 'vsl-stats-lab', schemaVersion: 1, engineVersion: 1, exportedAt: new Date().toISOString(), source: { kind: 'vsl-readonly', sourceProject: 'vsl' }, match: { id: loaded.state.id, meta: loaded.state.meta }, rosterSnapshots: loaded.state.roster, commandLog: loaded.commands.map(({ revision: _revision, ...command }) => command) }
}

export function validateBundle(value, byteSize = 0) {
  if (byteSize > MAX_BYTES) throw new Error('Файл больше 10 МБ')
  if (!value || value.format !== 'vsl-stats-lab' || value.schemaVersion !== 1) throw new Error('Неподдерживаемый формат или версия')
  if (!Array.isArray(value.commandLog) || value.commandLog.length > MAX_COMMANDS) throw new Error('Некорректный журнал команд')
  if (!value.match?.id || !Array.isArray(value.rosterSnapshots)) throw new Error('В файле отсутствуют данные матча')
  return value
}

export function downloadJson(loaded) {
  const data = JSON.stringify(makeBundle(loaded), null, 2)
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = `vsl-stats-lab-${loaded.state.id}.json`; a.click(); URL.revokeObjectURL(url)
}
