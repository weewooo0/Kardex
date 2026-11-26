export const THEME_PRESETS = [
  {
    id: 'obsidian',
    name: 'True Obsidian',
    mode: 'dark',
    themeColor: '#0C0C0D',
    swatches: ['#0C0C0D', '#161618', '#F5F5F4'],
  },
  {
    id: 'paper',
    name: 'Ink & Paper',
    mode: 'light',
    themeColor: '#F7F7F5',
    swatches: ['#F7F7F5', '#FFFFFF', '#111111'],
  },
];

export const ACCENT_PRESETS = [
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Cobalt', hex: '#3b82f6' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Amber', hex: '#f59e0b' },
];

export const ACCENT_VAR_NAMES = [
  '--accent',
  '--accent-strong',
  '--accent-border',
  '--accent-dim',
  '--accent-soft',
  '--accent-tint',
  '--accent-txt',
  '--accent-on-solid',
];

const THEME_MAP = new Map(THEME_PRESETS.map((p) => [p.id, p]));

export function normalizeThemeId(id) {
  const key = String(id || '').trim().toLowerCase();
  if (key === 'paper' || key === 'daylight' || key === 'light') return 'paper';
  if (
    key === 'obsidian' ||
    key === 'midnight' ||
    key === 'amoled' ||
    key === 'slate' ||
    key === 'charcoal' ||
    key === 'dark'
  ) {
    return 'obsidian';
  }
  return 'obsidian';
}

export function getThemePreset(id) {
  return THEME_MAP.get(normalizeThemeId(id));
}

export function normalizeHexColor(hex) {
  const raw = String(hex || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  const shortMatch = /^#([0-9a-f]{3})$/.exec(raw);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '';
}

function hexToRgb(hex) {
  const norm = normalizeHexColor(hex);
  if (!norm) return null;
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
  };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hue < 60) { r1 = c; g1 = x; }
  else if (hue < 120) { r1 = x; g1 = c; }
  else if (hue < 180) { g1 = c; b1 = x; }
  else if (hue < 240) { g1 = x; b1 = c; }
  else if (hue < 300) { r1 = x; b1 = c; }
  else { r1 = c; b1 = x; }

  const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const toLinear = (channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

export function computeAccentVars(hex, mode = 'dark') {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const isLight = mode === 'light';

  let accentLightness = isLight ? Math.min(l, 0.38) : Math.max(l, 0.62);
  let accent = hslToHex(h, s, accentLightness);
  if (!isLight) {
    while (relativeLuminance(accent) < 0.26 && accentLightness < 0.92) {
      accentLightness = Math.min(0.92, accentLightness + 0.03);
      accent = hslToHex(h, s, accentLightness);
    }
  } else {
    while (relativeLuminance(accent) > 0.24 && accentLightness > 0.14) {
      accentLightness = Math.max(0.14, accentLightness - 0.03);
      accent = hslToHex(h, s, accentLightness);
    }
  }
  const accentStrong = isLight
    ? hslToHex(h, s, clamp(l, 0.30, 0.42))
    : hslToHex(h, s, clamp(l, 0.28, 0.44));
  const accentBorder = isLight
    ? hslToHex(h, s, clamp(l, 0.35, 0.52))
    : hslToHex(h, s, clamp(l, 0.45, 0.62));
  const accentDim = hslToHex(h, s, isLight ? 0.91 : 0.19);
  const accentSoft = hslToHex(h, s, isLight ? 0.95 : 0.13);
  const accentTint = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isLight ? '0.12' : '0.15'})`;
  const accentTxt = hslToHex(h, s, isLight ? 0.24 : 0.88);
  const accentOnSolid = relativeLuminance(accentStrong) > 0.42 ? '#0f172a' : '#ffffff';

  return {
    '--accent': accent,
    '--accent-strong': accentStrong,
    '--accent-border': accentBorder,
    '--accent-dim': accentDim,
    '--accent-soft': accentSoft,
    '--accent-tint': accentTint,
    '--accent-txt': accentTxt,
    '--accent-on-solid': accentOnSolid,
  };
}
