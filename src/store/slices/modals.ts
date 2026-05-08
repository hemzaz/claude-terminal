import { StateCreator } from 'zustand';
import type { AppState, ModalKind, ModalsSlice } from '../types';

function getModalState(
  modal: ModalKind | null,
  options?: { profileId?: string; repoPath?: string },
): Pick<ModalsSlice, 'activeModal' | 'editingProfileId' | 'worktreeModalRepoPath'> {
  return {
    activeModal: modal,
    editingProfileId: modal === 'profile' ? (options?.profileId ?? null) : null,
    worktreeModalRepoPath: modal === 'worktree' ? (options?.repoPath ?? null) : null,
  };
}

export const createModalsSlice: StateCreator<AppState, [], [], ModalsSlice> = (set) => ({
  activeModal: null,
  editingProfileId: null,
  worktreeModalRepoPath: null,

  openModal: (modal, options) => set(getModalState(modal, options)),
  closeModal: () => set(getModalState(null)),
  replaceModal: (modal, options) => set(getModalState(modal, options)),
});
