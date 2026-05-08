import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, LayoutGrid, HelpCircle, Terminal, Settings, Command } from 'lucide-react';
import { useAppStore } from '../store/appStore';

interface TourStep {
  icon: React.ElementType;
  title: string;
  description: string;
}

const STEPS: TourStep[] = [
  {
    icon: Terminal,
    title: 'Terminal Tabs',
    description:
      'Each Claude Code session lives in its own tab. Create new terminals with the + button in the sidebar or press Ctrl+T. Switch between sessions instantly.',
  },
  {
    icon: LayoutGrid,
    title: 'Grid Mode',
    description:
      'Run up to 8 terminals side-by-side. Press Cmd+G (macOS) or Ctrl+G (Windows) to enter grid mode and watch multiple Claude agents work in parallel.',
  },
  {
    icon: HelpCircle,
    title: 'Hints Panel',
    description:
      'Press F1 to open the Hints Panel — a handy reference of Claude Code commands and slash commands so you never have to leave the app to look things up.',
  },
  {
    icon: Command,
    title: 'Command Palette',
    description:
      'Press Cmd+K (macOS) or Ctrl+K (Windows) to open the Command Palette. Search terminals, workspaces, profiles, and actions from one place.',
  },
  {
    icon: Settings,
    title: 'Settings & Profiles',
    description:
      'Open Settings (gear icon) to configure Claude args, notifications, and update preferences. Save reusable configurations as Profiles for quick terminal launch.',
  },
];

interface OnboardingTourProps {
  onDismiss: () => void;
}

export function OnboardingTour({ onDismiss }: OnboardingTourProps) {
  const [step, setStep] = useState(0);
  const { setOnboardingCompleted } = useAppStore();

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];
  const Icon = current.icon;

  const finish = () => {
    setOnboardingCompleted(true);
    onDismiss();
  };

  const handleNext = () => {
    if (isLast) {
      finish();
    } else {
      setStep((s) => s + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="bg-bg-elevated ring-1 ring-white/[0.08] rounded-lg shadow-2xl w-full max-w-md overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-bg-surface flex items-center justify-center">
                <Icon size={18} className="text-text-secondary" />
              </div>
              <div>
                <p className="text-[11px] text-text-tertiary font-medium uppercase tracking-wider">
                  Getting started — {step + 1} / {STEPS.length}
                </p>
                <h2 className="text-[15px] font-semibold text-text-primary leading-tight">
                  {current.title}
                </h2>
              </div>
            </div>
            <button
              onClick={finish}
              aria-label="Skip tour"
              className="text-text-tertiary hover:text-text-primary transition-colors p-1 rounded"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="p-5">
            <p className="text-text-secondary text-[13px] leading-relaxed">
              {current.description}
            </p>
          </div>

          {/* Step dots */}
          <div className="px-5 pb-1 flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === step
                    ? 'w-4 bg-accent-primary'
                    : i < step
                    ? 'w-1.5 bg-accent-primary/40'
                    : 'w-1.5 bg-white/10'
                }`}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border flex items-center justify-between">
            <button
              onClick={finish}
              className="text-text-tertiary hover:text-text-secondary text-[12px] transition-colors"
            >
              Skip tour
            </button>
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 bg-accent-primary hover:bg-accent-secondary text-white h-8 px-4 rounded-md text-[13px] font-medium transition-colors"
            >
              {isLast ? 'Done' : 'Next'}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
