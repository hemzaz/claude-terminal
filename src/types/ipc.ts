/**
 * Frontend types for Tauri IPC payloads.
 *
 * Keep these aligned with the Rust command payloads and database-backed
 * records. Field names intentionally remain snake_case to match runtime data.
 */

export type TerminalStatus = 'Running' | 'Idle' | 'Error' | 'Stopped';

export interface TerminalConfig {
  id: string;
  label: string;
  nickname: string | null;
  profile_id: string | null;
  working_directory: string;
  claude_args: string[];
  env_vars: Record<string, string>;
  created_at: string;
  status: TerminalStatus;
  color_tag: string | null;
  pinned: boolean;
}

export interface ConfigProfile {
  id: string;
  name: string;
  description: string | null;
  working_directory: string;
  claude_args: string[];
  env_vars: Record<string, string>;
  is_default: boolean;
  last_used_at?: string | null;
}

export interface SavedTerminalConfig {
  id?: string;
  label: string;
  nickname: string | null;
  working_directory: string;
  claude_args: string[];
  env_vars: Record<string, string>;
  color_tag: string | null;
  pinned?: boolean;
}

export interface SessionHistoryEntry {
  id: number;
  terminal_id: string;
  label: string;
  started_at: string;
  ended_at: string | null;
  log_path: string | null;
}

export interface SavedTerminalSlot {
  label: string;
  working_directory: string;
  claude_args: string[];
  env_vars: Record<string, string>;
  color_tag: string | null;
  nickname: string | null;
}

export interface LayoutTemplate {
  id: string;
  name: string;
  layout: string;
  terminal_configs: string;
  created_at: string;
}
