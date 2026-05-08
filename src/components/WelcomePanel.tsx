import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { reportError } from '../lib/reportError';
import { TerminalSquare, Code2, Clock, Layers, Sparkles, ArrowRight } from 'lucide-react';
import appIconUrl from '../assets/app-icon.png';
import { useAppStore } from '../store/appStore';

interface WelcomeCard {
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
  accent?: boolean;
}

export function WelcomePanel() {
  const [hasHistory, setHasHistory] = useState(false);
  const [hasProfiles, setHasProfiles] = useState(false);

  useEffect(() => {
    invoke<{ id: number }[]>('get_session_history')
      .then((entries) => setHasHistory(entries.length > 0))
      .catch(reportError('get_session_history'));
    invoke<{ id: string }[]>('get_profiles')
      .then((profiles) => setHasProfiles(profiles.length > 0))
      .catch(reportError('get_profiles'));
  }, []);

  const cards: WelcomeCard[] = [
    {
      icon: TerminalSquare,
      title: 'New Claude session',
      description: 'Start a fresh Claude Code terminal',
      onClick: () => useAppStore.getState().openModal('newTerminal'),
      accent: true,
    },
    {
      icon: Code2,
      title: 'New shell terminal',
      description: 'Open an interactive shell at any folder',
      onClick: () => useAppStore.getState().openModal('newTerminal'),
    },
    ...(hasHistory
      ? [
          {
            icon: Clock,
            title: 'Reopen recent',
            description: 'Browse and restore past sessions',
            onClick: () => useAppStore.getState().openModal('sessionHistory'),
          } satisfies WelcomeCard,
        ]
      : []),
    ...(hasProfiles
      ? [
          {
            icon: Layers,
            title: 'Start from profile',
            description: 'Launch a saved configuration preset',
            onClick: () => useAppStore.getState().openModal('newTerminal'),
          } satisfies WelcomeCard,
        ]
      : []),
    {
      icon: Sparkles,
      title: "What's New",
      description: 'See the latest features and changes',
      onClick: () => useAppStore.getState().openModal('whatsNew'),
    },
  ];

  return (
    <div className="h-full w-full flex flex-col items-center justify-center p-8 select-none">
      <div className="flex flex-col items-center gap-3 mb-10">
        <img src={appIconUrl} alt="ClaudeTerminal" className="w-12 h-12 opacity-90" />
        <div className="text-center">
          <h1 className="text-text-primary text-[18px] font-semibold tracking-tight">
            ClaudeTerminal
          </h1>
          <p className="text-text-tertiary text-[13px] mt-1">
            Start a new session or pick up where you left off
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full max-w-[680px]">
        {cards.map((card) => (
          <button
            key={card.title}
            onClick={card.onClick}
            className={`group flex flex-col gap-3 p-4 rounded-xl text-left transition-all ring-1 ${
              card.accent
                ? 'bg-accent-primary/10 ring-accent-primary/25 hover:bg-accent-primary/15 hover:ring-accent-primary/45'
                : 'bg-elevation-2 ring-white/[0.07] hover:bg-elevation-3 hover:ring-white/[0.12]'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                card.accent ? 'bg-accent-primary/20' : 'bg-white/[0.06]'
              }`}
            >
              <card.icon
                size={16}
                strokeWidth={1.75}
                className={card.accent ? 'text-accent-primary' : 'text-text-secondary'}
              />
            </div>
            <div className="flex-1">
              <div
                className={`text-[13px] font-medium leading-snug ${
                  card.accent ? 'text-accent-primary' : 'text-text-primary'
                }`}
              >
                {card.title}
              </div>
              <div className="text-text-tertiary text-[12px] mt-0.5 leading-snug">
                {card.description}
              </div>
            </div>
            <ArrowRight
              size={12}
              strokeWidth={1.75}
              className={`self-end opacity-0 group-hover:opacity-100 transition-opacity ${
                card.accent ? 'text-accent-primary' : 'text-text-secondary'
              }`}
            />
          </button>
        ))}
      </div>

      <p className="mt-8 text-text-tertiary/60 text-[11px]">
        Press{' '}
        <kbd className="font-mono bg-white/[0.06] px-1 py-0.5 rounded text-[10px]">Cmd+T</kbd>
        {' '}or{' '}
        <kbd className="font-mono bg-white/[0.06] px-1 py-0.5 rounded text-[10px]">Ctrl+T</kbd>
        {' '}to open a new terminal at any time
      </p>
    </div>
  );
}
