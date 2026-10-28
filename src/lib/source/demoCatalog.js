export const demoCatalog = {
  leagues: [{ id: 'demo-league', name: 'demo', display_name: 'Демо-лига', gender: 'mixed', active: true }],
  seasons: [{ id: 'demo-season', name: 'Тестовый сезон', is_current: true }],
  teams: [
    { id: 'demo-a', name: 'Синие', league: 'demo' },
    { id: 'demo-b', name: 'Оранжевые', league: 'demo' },
  ],
}

export function demoRoster(teamId, seasonId, teamSnapshotId) {
  const names = teamId === 'demo-a'
    ? ['Алексей Орлов', 'Иван Соколов', 'Дамир Алиев', 'Максим Романов', 'Антон Волков', 'Павел Миронов', 'Илья Лебедев', 'Никита Зайцев', 'Роман Фролов', 'Артём Козлов']
    : ['Рустам Каримов', 'Тимур Юсупов', 'Арсен Ким', 'Олег Белов', 'Саид Азимов', 'Егор Петров', 'Марат Нуров', 'Денис Хан', 'Амир Усманов', 'Вадим Попов']
  return names.map((displayName, index) => ({
    id: crypto.randomUUID(), sourcePlayerId: null, sourceMembershipId: null,
    teamId: teamSnapshotId, sourceTeamId: teamId, sourceSeasonId: seasonId,
    displayName, jerseyNumber: index + 1, sourcePosition: index === 5 ? 'libero' : index === 0 ? 'setter' : 'player',
    sourcePosition2: null, matchRole: index === 5 ? 'libero' : index === 0 ? 'setter' : 'player',
    isCaptain: index === 0, photoUrl: null, fetchedAt: new Date().toISOString(), localOverrides: {}, active: true,
  }))
}
