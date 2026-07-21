import { create } from "zustand";

// CLIENT STATE ONLY. This store holds pure UI concerns — nothing that lives on
// the server. "Which project row is selected" is a UI decision; the project
// DATA it points at is SERVER state and lives in TanStack Query (queries.ts).
//
// Keeping the two apart is the whole modern mental model: the selection here
// never goes stale (it's just an id), and the list over in Query can refetch,
// cache, and invalidate without this store knowing or caring.
type UiState = {
  selectedProjectId: string | null;
  select: (id: string | null) => void;
};

export const useUiStore = create<UiState>((set) => ({
  selectedProjectId: null,
  select: (id) => set({ selectedProjectId: id }),
}));
