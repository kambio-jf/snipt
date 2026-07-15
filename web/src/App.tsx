/**
 * KMBO-252 vertical slice: upload -> transcribe -> transcript.
 * Deliberately thin — it exists to prove handler → service → dao → lib → queue → React.
 * The real Editor (KMBO-253) replaces this screen.
 */
import { useEffect, useState } from "react";
import { api } from "./api/client.js";
import { useJob } from "./api/hooks.js";
import { Transcript } from "./Transcript.js";

type Project = { id: string; name: string; createdAt: string };
type Asset = { id: string; uri: string; durationS: number | null; width: number | null; height: number | null };

const mmss = (s: number | null) =>
  s === null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const job = useJob(jobId);

  async function loadProjects() {
    const { data, error } = await api.GET("/api/video-projects", {});
    if (error) return setError("Failed to load projects");
    setProjects(data.items);
    if (!projectId && data.items[0]) setProjectId(data.items[0].id);
  }

  async function loadAssets(id: string) {
    const { data, error } = await api.GET("/api/video-projects/{videoProjectId}/video-assets", {
      params: { path: { videoProjectId: id } },
    });
    if (error) return setError("Failed to load assets");
    setAssets(data.items);
  }

  useEffect(() => { void loadProjects(); }, []);
  useEffect(() => { if (projectId) void loadAssets(projectId); }, [projectId]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { data, error } = await api.POST("/api/video-projects", { body: { name } });
    if (error) return setError("Failed to create project");
    setName("");
    setProjectId(data.id);
    await loadProjects();
  }

  /**
   * Uploaded with a raw fetch, not the typed client: openapi-fetch serializes JSON, and
   * this needs a streamed multipart body for multi-GB recordings.
   */
  async function upload(file: File) {
    if (!projectId) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/video-projects/${projectId}/video-assets`, { method: "POST", body });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.message ?? `Upload failed (${res.status})`);
      }
      const asset = (await res.json()) as Asset;
      await loadAssets(projectId);
      setAssetId(asset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function transcribe(id: string) {
    setError(null);
    setAssetId(id);
    const { data, error } = await api.POST("/api/video-assets/{videoAssetId}/transcript", {
      params: { path: { videoAssetId: id } },
    });
    if (error) return setError((error as { message?: string }).message ?? "Failed to enqueue transcription");
    setJobId(data.jobId);
  }

  async function cancel() {
    if (!jobId) return;
    await api.POST("/api/video-processing-jobs/{jobId}/cancel", { params: { path: { jobId } } });
  }

  const busy = job !== null && (job.status === "queued" || job.status === "running");

  return (
    <main className="wrap">
      <h1>Video Tools</h1>
      <p className="sub">Upload a recording, transcribe it, read it back with word timings.</p>

      {error && <p className="err">{error}</p>}

      <h2>Project</h2>
      <div className="card">
        <div className="row" style={{ marginBottom: projects.length ? ".75rem" : 0 }}>
          <form onSubmit={createProject} className="row" style={{ flex: 1 }}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New project name"
              style={{ flex: 1 }}
            />
            <button type="submit">Create</button>
          </form>
        </div>
        {projects.length > 0 && (
          <select
            value={projectId ?? ""}
            onChange={(e) => { setProjectId(e.target.value); setAssetId(null); setJobId(null); }}
            style={{ width: "100%", padding: ".5rem", font: "inherit" }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {projectId && (
        <>
          <h2>Recording</h2>
          <div className="card">
            <input
              type="file"
              accept="video/*"
              disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
            />
            {uploading && <p className="muted" style={{ margin: ".5rem 0 0" }}>Uploading…</p>}
          </div>

          {assets.length > 0 && (
            <ul className="list" style={{ marginTop: ".5rem" }}>
              {assets.map((a) => (
                <li key={a.id}>
                  <span>
                    <code className="muted">{a.id.slice(0, 8)}</code>{" "}
                    <span className="pill">{mmss(a.durationS)}</span>{" "}
                    <span className="pill">{a.width}×{a.height}</span>
                  </span>
                  <button onClick={() => void transcribe(a.id)} disabled={busy} className="primary">
                    Transcribe
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {job && (
        <>
          <h2>Job</h2>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: ".5rem" }}>
              <span>
                <strong>{job.status}</strong>
                {job.stage && <span className="muted"> — {job.stage}</span>}
              </span>
              {busy ? <button onClick={() => void cancel()}>Cancel</button> : <span className="muted">{job.progress}%</span>}
            </div>
            <div className="bar"><i style={{ width: `${job.status === "done" ? 100 : job.progress}%` }} /></div>
            {job.error && <p className="err" style={{ marginBottom: 0 }}>{job.error}</p>}
          </div>
        </>
      )}

      {assetId && job?.status === "done" && <Transcript videoAssetId={assetId} />}
    </main>
  );
}
