import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import theme from '../../../../themes/lumixengine-dark.json';
import './globals.css';

export const metadata: Metadata = {
  title: 'ArenaHub',
  description: 'Gestão de arenas esportivas',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const colors = theme.colors;
  const themeStyle = {
    '--color-background': colors.background,
    '--color-surface': colors.surface,
    '--color-surface-raised': colors.surfaceRaised,
    '--color-border': colors.border,
    '--color-text': colors.text,
    '--color-text-muted': colors.textMuted,
    '--color-primary': colors.primary,
    '--color-primary-hover': colors.primaryHover,
    '--color-primary-contrast': colors.primaryContrast,
    '--color-accent': colors.accent,
  } as CSSProperties;

  return (
    <html lang="pt-BR" style={themeStyle}>
      <body>{children}</body>
    </html>
  );
}
