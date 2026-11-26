import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ThemeSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  mode: z.enum(['light', 'dark']),
  brand: z.object({
    displayName: z.string().min(1),
    logo: z.string(),
    logoMark: z.string(),
    favicon: z.string(),
  }),
  fonts: z.object({ heading: z.string(), body: z.string() }),
  radius: z.enum(['sharp', 'rounded', 'soft']),
  colors: z.object({
    background: color,
    surface: color,
    surfaceRaised: color,
    border: color,
    text: color,
    textMuted: color,
    primary: color,
    primaryHover: color,
    primaryContrast: color,
    accent: color,
    brandGradient: z.tuple([color, color]),
  }),
  effects: z.object({ glow: z.boolean() }),
});

export type Theme = z.infer<typeof ThemeSchema>;
