import { CommandType } from './commands.js'
import { applyCommand, createEmptyState } from './reducer.js'

export function activeCommandIds(commands) {
  const active = new Set(commands.filter(c => ![CommandType.UNDO, CommandType.REDO].includes(c.type)).map(c => c.commandId))
  for (const command of commands) {
    if (command.type === CommandType.UNDO) active.delete(command.payload.targetCommandId)
    if (command.type === CommandType.REDO) active.add(command.payload.targetCommandId)
  }
  return active
}

export function replay(commands) {
  const active = activeCommandIds(commands)
  let state = createEmptyState()
  for (const command of commands) {
    if ([CommandType.UNDO, CommandType.REDO].includes(command.type) || !active.has(command.commandId)) continue
    state = applyCommand(state, command).nextState
  }
  state.revision = commands.length
  return state
}

export function latestUndoable(commands) {
  const active = activeCommandIds(commands)
  return [...commands].reverse().find(c => active.has(c.commandId) && ![CommandType.CREATE_MATCH, CommandType.START_SET].includes(c.type)) || null
}

export function latestRedoable(commands) {
  const active = activeCommandIds(commands)
  const undone = commands.filter(c => ![CommandType.UNDO, CommandType.REDO].includes(c.type) && !active.has(c.commandId))
  return undone.at(-1) || null
}
