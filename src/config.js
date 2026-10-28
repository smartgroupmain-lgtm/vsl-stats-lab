export const config = {
  appMode: import.meta.env.VITE_APP_MODE || 'lab',
  sourceUrl: import.meta.env.VITE_VSL_SOURCE_URL || '',
  sourceKey: import.meta.env.VITE_VSL_SOURCE_PUBLIC_KEY || '',
  syncAccessKey: import.meta.env.VITE_STATS_LAB_ACCESS_KEY || '',
  assetBaseUrl: import.meta.env.VITE_VSL_ASSET_BASE_URL || 'https://vsl-league.vercel.app',
}
