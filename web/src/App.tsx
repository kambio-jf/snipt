// Scaffold screen — proves the round trip: typed client → Fastify → Drizzle → SQLite.
// The real Editor (KMBO-253) replaces this.
import { useEffect, useState } from "react";
import { api } from "./api/client.js";

type VideoProject = { id: string; name: string; createdAt: string };

export function App() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const { data, error } = await api.GET("/api/video-projects", {});
    if (error) return setError("Failed to load projects");
    setProjects(data.items);
    setError(null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await api.POST("/api/video-projects", { body: { name } });
    if (error) return setError("Failed to create project");
    setName("");
    await load();
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Video Tools</h1>
      <p style={{ color: "#666" }}>Scaffold — project module wired end to end.</p>

      <form onSubmit={create} style={{ display: "flex", gap: 8, margin: "1.5rem 0" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" style={{ padding: "8px 16px" }}>Create</button>
      </form>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <ul style={{ paddingLeft: 0, listStyle: "none" }}>
        {projects.map((p) => (
          <li key={p.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
            <strong>{p.name}</strong>
            <span style={{ color: "#999", marginLeft: 8, fontSize: 13 }}>
              {new Date(p.createdAt).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
      {projects.length === 0 && !error && <p style={{ color: "#999" }}>No projects yet.</p>}
    </main>
  );
}
