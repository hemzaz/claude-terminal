import { useRef, useEffect } from 'react';
import { Radio, X } from 'lucide-react';
import { useTerminalStore } from '../store/terminalStore';

interface BroadcastPopoverProps {
  onClose: () => void;
}

export function BroadcastPopover({ onClose }: BroadcastPopoverProps) {
  const { terminals, broadcastGroupIds, toggleBroadcastMember, clearBroadcastGroup } = useTerminalStore();
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const terminalList = Array.from(terminals.values()).filter(
    (t) => !t.scriptParentId && !t.isShellTerminal,
  );

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-1 z-50 bg-elevation-2 border border-[var(--ij-divider)] rounded-lg shadow-xl min-w-[220px] py-1"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--ij-divider)] mb-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
          <Radio size={11} className="text-orange-400" />
          Broadcast Group
        </div>
        {broadcastGroupIds.size > 0 && (
          <button
            onClick={clearBroadcastGroup}
            className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
            title="Clear broadcast group"
          >
            Clear all
          </button>
        )}
      </div>

      {terminalList.length === 0 && (
        <p className="text-text-tertiary text-[11px] px-3 py-2">No terminals open.</p>
      )}

      {terminalList.map((instance) => {
        const { id, nickname, label, color_tag } = instance.config;
        const isMember = broadcastGroupIds.has(id);
        return (
          <button
            key={id}
            onClick={() => toggleBroadcastMember(id)}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
              isMember
                ? 'bg-orange-500/10 text-text-primary'
                : 'hover:bg-white/[0.04] text-text-secondary'
            }`}
          >
            {/* Checkbox indicator */}
            <span
              className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                isMember
                  ? 'bg-orange-500 border-orange-500'
                  : 'border-text-tertiary'
              }`}
            >
              {isMember && <X size={9} strokeWidth={3} className="text-white" />}
            </span>
            {color_tag && (
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color_tag}`} />
            )}
            <span className="text-[12px] truncate">{nickname || label}</span>
            {isMember && (
              <Radio size={10} className="text-orange-400 flex-shrink-0 ml-auto" />
            )}
          </button>
        );
      })}

      {broadcastGroupIds.size >= 2 && (
        <div className="mt-1 px-3 py-1.5 border-t border-[var(--ij-divider)] text-[10px] text-orange-400">
          Broadcasting to {broadcastGroupIds.size} terminals
        </div>
      )}
      {broadcastGroupIds.size === 1 && (
        <div className="mt-1 px-3 py-1.5 border-t border-[var(--ij-divider)] text-[10px] text-text-tertiary">
          Select at least 2 terminals to broadcast
        </div>
      )}
    </div>
  );
}
