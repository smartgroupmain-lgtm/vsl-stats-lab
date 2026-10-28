import { useRegisterSW } from 'virtual:pwa-register/react'
export default function UpdateBanner({ matchActive }) {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW()
  if (!needRefresh) return null
  return <div className="update-banner"><span>{matchActive ? 'Обновление готово. Примените после матча.' : 'Доступно обновление приложения.'}</span><button disabled={matchActive} onClick={() => updateServiceWorker(true)}>Обновить</button><button className="ghost" onClick={() => setNeedRefresh(false)}>Позже</button></div>
}
