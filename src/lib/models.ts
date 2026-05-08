/**
 * Centralized Claude model registry.
 *
 * All UI components that render a model picker or a model badge should import
 * from here so that adding/renaming a model is a one-line change.
 */
export const CLAUDE_MODELS = [
  { id: 'default', label: 'Default', badge: 'bg-accent-primary/10 text-accent-primary' },
  { id: 'opus',    label: 'Opus',    badge: 'bg-purple-500/20 text-purple-400'         },
  { id: 'sonnet',  label: 'Sonnet',  badge: 'bg-blue-500/20 text-blue-400'             },
  { id: 'haiku',   label: 'Haiku',   badge: 'bg-green-500/20 text-green-400'           },
] as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id'];

/**
 * Returns the Tailwind badge class string for a given model id.
 * Falls back to a neutral muted style for unknown/undefined ids.
 */
export const modelBadge = (id?: string): string =>
  CLAUDE_MODELS.find((m) => m.id === id)?.badge ?? 'bg-white/[0.06] text-text-tertiary';
