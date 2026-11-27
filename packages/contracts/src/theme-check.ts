import { ThemeSchema } from './theme.js';
function luminance(hex: string) {
  const components = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * components[0]! + 0.7152 * components[1]! + 0.0722 * components[2]!;
}
export function checkTheme(value: unknown) {
  const theme = ThemeSchema.parse(value);
  const c = theme.colors;
  for (const [text, bg] of [
    [c.text, c.background],
    [c.text, c.surface],
    [c.textMuted, c.background],
    [c.textMuted, c.surface],
    [c.primaryContrast, c.primary],
    [c.primaryContrast, c.primaryHover],
  ] as const) {
    const a = luminance(text),
      b = luminance(bg);
    if ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 4.5)
      throw Error('Ajuste o contraste entre ' + text + ' e ' + bg);
  }
  return theme;
}
