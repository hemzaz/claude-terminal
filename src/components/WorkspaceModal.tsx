import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Trash2, FolderOpen, Play } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../store/appStore';
import { useTerminalStore } from '../store/terminalStore';
import { toast } from '../store/toastStore';
import type { SavedTerminalConfig } from '../types/ipc';

interface WorkspaceInfo {
  name: string;
  terminal_count: number;
  created_at: string;
}

export function WorkspaceModal() {
  const { closeModal } = useAppStore();
  const { terminals, createTerminal } = useTerminalStore();

  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<WorkspaceInfo | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      const loaded = await invoke<WorkspaceInfo[]>('get_workspaces');
      setWorkspaces(loaded);
    } catch (err) {
      console.error('Failed to load workspaces:', err);
    }
  };

  const handleSaveWorkspace = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const configs = Array.from(terminals.values()).map(t => t.config);
      const name = newName.trim();
      await invoke('save_workspace', { name, terminals: configs });
      setNewName('');
      await loadWorkspaces();
      toast.success('Workspace Saved', `"${name}" with ${configs.length} terminal${configs.length !== 1 ? 's' : ''}.`);
    } catch (err) {
      console.error('Failed to save workspace:', err);
      toast.error('Save Failed', 'Could not save workspace.');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadWorkspace = async () => {
    if (!selectedWorkspace) return;
    setLoading(true);
    try {
      const configs = await invoke<SavedTerminalConfig[]>('load_workspace', { name: selectedWorkspace.name });
      for (const config of configs) {
        await createTerminal(
          config.label,
          config.working_directory,
          config.claude_args,
          config.env_vars,
          config.color_tag ?? undefined,
          config.nickname ?? undefined
        );
      }
      toast.success('Workspace Loaded', `"${selectedWorkspace.name}" with ${configs.length} terminal${configs.length !== 1 ? 's' : ''}.`);
      closeModal();
    } catch (err) {
      console.error('Failed to load workspace:', err);
      toast.error('Load Failed', 'Could not load workspace.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!selectedWorkspace) return;
    try {
      const name = selectedWorkspace.name;
      await invoke('delete_workspace', { name });
      setSelectedWorkspace(null);
      await loadWorkspaces();
      toast.success('Workspace Deleted', `"${name}" has been removed.`);
    } catch (err) {
      console.error('Failed to delete workspace:', err);
      toast.error('Delete Failed', 'Could not delete workspace.');
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onDoubleClick={closeModal}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onDoubleClick={(e) => e.stopPropagation()}
        className="bg-bg-elevated ring-1 ring-white/[0.08] rounded-lg shadow-2xl w-full max-w-3xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FolderOpen size={16} className="text-text-secondary" />
            <h2 className="text-text-primary text-[14px] font-semibold">Workspaces</h2>
          </div>
          <button
            onClick={closeModal}
            className="p-1 rounded hover:bg-white/[0.06] text-text-tertiary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex h-[400px]">
          {/* Left: Workspace List + Save */}
          <div className="w-64 border-r border-border p-3 flex flex-col">
            {/* Save Current */}
            <div className="flex gap-1.5 mb-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveWorkspace(); }}
                placeholder="Workspace name..."
                className="flex-1 bg-bg-primary ring-1 ring-border-light rounded-md h-8 px-2 text-text-primary text-[12px] focus:outline-none focus:ring-accent-primary transition-colors"
              />
              <button
                onClick={handleSaveWorkspace}
                disabled={!newName.trim() || saving || terminals.size === 0}
                className="flex items-center gap-1 bg-accent-primary hover:bg-accent-secondary disabled:opacity-50 disabled:cursor-not-allowed text-white h-8 px-2.5 rounded-md text-[11px] font-medium transition-colors flex-shrink-0"
              >
                <Save size={12} />
                Save
              </button>
            </div>

            {/* Workspace List */}
            <div className="flex-1 overflow-y-auto space-y-0.5">
              {workspaces.map((ws) => (
                <div
                  key={ws.name}
                  onClick={() => setSelectedWorkspace(ws)}
                  className={`p-2 rounded-md cursor-pointer transition-colors ${
                    selectedWorkspace?.name === ws.name
                      ? 'bg-accent-primary/10 ring-1 ring-accent-primary/30'
                      : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <p className="text-text-primary text-[12px] font-medium truncate">{ws.name}</p>
                  <p className="text-text-tertiary text-[11px]">
                    {ws.terminal_count} terminal{ws.terminal_count !== 1 ? 's' : ''}
                  </p>
                </div>
              ))}

              {workspaces.length === 0 && (
                <p className="text-text-tertiary text-[12px] text-center py-4">
                  No saved workspaces
                </p>
              )}
            </div>
          </div>

          {/* Right: Details */}
          <div className="flex-1 p-4 flex flex-col">
            {selectedWorkspace ? (
              <>
                <div className="flex-1 space-y-3">
                  <div>
                    <label className="block text-text-tertiary text-[11px] mb-0.5">Name</label>
                    <p className="text-text-primary text-[14px] font-medium">{selectedWorkspace.name}</p>
                  </div>
                  <div>
                    <label className="block text-text-tertiary text-[11px] mb-0.5">Terminals</label>
                    <p className="text-text-primary text-[13px]">
                      {selectedWorkspace.terminal_count} terminal{selectedWorkspace.terminal_count !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div>
                    <label className="block text-text-tertiary text-[11px] mb-0.5">Created</label>
                    <p className="text-text-primary text-[13px]">{formatDate(selectedWorkspace.created_at)}</p>
                  </div>
                </div>

                <div className="flex gap-2 pt-4 border-t border-border">
                  <button
                    onClick={handleLoadWorkspace}
                    disabled={loading}
                    className="flex items-center gap-2 bg-accent-primary hover:bg-accent-secondary disabled:opacity-50 text-white h-9 px-4 rounded-md text-[13px] font-medium transition-colors"
                  >
                    <Play size={14} />
                    {loading ? 'Loading...' : 'Load Workspace'}
                  </button>
                  <button
                    onClick={handleDeleteWorkspace}
                    className="flex items-center gap-2 text-red-400 hover:bg-red-500/10 h-9 px-4 rounded-md text-[13px] font-medium transition-colors"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-text-tertiary text-[13px]">
                Select a workspace or save the current session
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
