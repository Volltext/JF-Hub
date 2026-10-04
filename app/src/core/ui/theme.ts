import type { ThemeMode } from '@/core/settings/settings';

export function applyTheme(mode: ThemeMode): void {
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
