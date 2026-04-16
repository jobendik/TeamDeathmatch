import type { WeaponId } from '@/config/weapons';

/**
 * Inline SVG icons for each weapon. Returns HTML string.
 * These are silhouette icons in a small fixed viewbox, styled via currentColor.
 */
const ICONS: Record<WeaponId, string> = {
  unarmed: `<svg viewBox="0 0 32 16" width="36" height="18"><path fill="currentColor" d="M6 8 L10 6 L14 6 L14 10 L10 10 Z M18 6 L22 6 L26 8 L22 10 L18 10 Z"/></svg>`,

  pistol: `<svg viewBox="0 0 40 20" width="40" height="20"><path fill="currentColor" d="M4 8 L26 8 L28 6 L32 6 L32 10 L28 10 L26 10 L26 14 L22 14 L20 16 L14 16 L14 14 L10 14 L10 10 L4 10 Z"/><rect fill="currentColor" x="22" y="8" width="6" height="2"/></svg>`,

  smg: `<svg viewBox="0 0 48 20" width="44" height="18"><path fill="currentColor" d="M4 8 L8 8 L8 6 L18 6 L18 4 L24 4 L24 6 L34 6 L36 8 L44 8 L44 10 L36 10 L36 12 L24 12 L24 14 L20 14 L20 16 L14 16 L14 14 L10 14 L10 10 L4 10 Z"/><rect fill="currentColor" x="34" y="10" width="6" height="4"/></svg>`,

  assault_rifle: `<svg viewBox="0 0 56 22" width="48" height="19"><path fill="currentColor" d="M2 10 L8 10 L8 8 L20 6 L22 4 L28 4 L28 6 L38 6 L40 8 L52 8 L52 12 L40 12 L40 14 L28 14 L28 16 L22 16 L20 18 L14 18 L14 14 L8 14 L8 12 L2 12 Z"/><rect fill="currentColor" x="30" y="12" width="6" height="4"/><rect fill="currentColor" x="42" y="6" width="2" height="2"/></svg>`,

  shotgun: `<svg viewBox="0 0 52 22" width="46" height="19"><path fill="currentColor" d="M2 9 L8 9 L8 7 L16 7 L22 5 L22 7 L42 7 L50 9 L50 13 L42 13 L42 15 L22 15 L20 17 L14 17 L14 13 L8 13 L8 11 L2 11 Z"/><rect fill="currentColor" x="42" y="13" width="6" height="2"/></svg>`,

  sniper_rifle: `<svg viewBox="0 0 64 22" width="52" height="18"><path fill="currentColor" d="M2 10 L8 10 L8 8 L16 8 L16 6 L20 6 L20 8 L30 8 L32 4 L40 4 L40 8 L50 8 L60 10 L60 12 L50 12 L40 12 L40 14 L30 14 L22 16 L14 16 L14 14 L8 14 L8 12 L2 12 Z"/><rect fill="currentColor" x="32" y="6" width="8" height="2"/></svg>`,

  rocket_launcher: `<svg viewBox="0 0 60 22" width="50" height="19"><path fill="currentColor" d="M4 8 L12 8 L16 6 L46 6 L54 8 L56 10 L56 12 L54 14 L46 14 L16 14 L12 14 L4 14 Z"/><path fill="currentColor" d="M24 16 L28 16 L30 20 L22 20 Z"/><circle fill="currentColor" cx="52" cy="10" r="2"/></svg>`,
};

export function getWeaponIconSVG(id: WeaponId): string {
  return ICONS[id] || ICONS.unarmed;
}

/** Short fire-mode label for weapon card. */
export function getWeaponModeLabel(id: WeaponId): string {
  switch (id) {
    case 'pistol': return 'SEMI';
    case 'smg': return 'AUTO';
    case 'assault_rifle': return 'BURST';
    case 'shotgun': return 'PUMP';
    case 'sniper_rifle': return 'BOLT';
    case 'rocket_launcher': return 'SINGLE';
    default: return '—';
  }
}
