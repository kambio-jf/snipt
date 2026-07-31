import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";

// SERVER STATE, via TanStack Query. Contrast with App.tsx, which does the same
// job with useState + useEffect + a manual loadProjects() + manual error flags.
// Here the hooks own caching, loading/error, and revalidation.

// One cache key = one source of truth for "the projects list".
const projectsKey = ["video-projects"] as const;

// Fetch + cache the list. Returns { data, isPending, isError, ... } and
// re-renders any component using it whenever the cache changes. The query fn
// still uses your existing type-safe openapi-fetch client — Query just wraps it.
export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/video-projects", {});
      if (error) throw new Error("Failed to load projects");
      return data.items; // typed straight from the OpenAPI schema
    },
  });
}

// A write that, on success, invalidates the projects cache — so every component
// reading useProjects() refetches automatically. This single line replaces the
// old imperative `await loadProjects()` scattered after each mutation.
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/api/video-projects", { body: { name } });
      if (error) throw new Error("Failed to create project");
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: projectsKey }),
  });
}
