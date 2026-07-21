import { useProjects } from "./queries.js";
import { useUiStore } from "./store.js";
import { NewProjectDialog } from "./NewProjectDialog.js";
import styles from "./ProjectsPanel.module.scss";

// The "after" of App.tsx's project section. Two state sources, cleanly split:
//   • SERVER state  -> useProjects()  (TanStack Query: cache, loading, error)
//   • CLIENT state  -> useUiStore()   (Zustand: which row is selected)
// Neither knows about the other.
export function ProjectsPanel() {
  const { data: projects, isPending, isError } = useProjects();
  const selectedId = useUiStore((s) => s.selectedProjectId);
  const select = useUiStore((s) => s.select);

  const selected = projects?.find((p) => p.id === selectedId) ?? null;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={styles.h2}>Projects</h2>
        <NewProjectDialog />
      </header>

      <div className={styles.grid}>
        {/* LEFT: the server-state list */}
        <div className={styles.listCol}>
          {isPending && <p className={styles.muted}>Loading…</p>}
          {isError && <p className={styles.err}>Failed to load projects.</p>}
          {projects?.length === 0 && <p className={styles.muted}>No projects yet.</p>}
          <ul className={styles.list}>
            {projects?.map((p) => (
              <li key={p.id}>
                <button
                  className={`${styles.item} ${p.id === selectedId ? styles.active : ""}`}
                  onClick={() => select(p.id)}
                >
                  <span className={styles.name}>{p.name}</span>
                  <code className={styles.muted}>{p.id.slice(0, 8)}</code>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* RIGHT: reads the client-state selection + the server-state record */}
        <aside className={styles.detail}>
          {selected ? (
            <>
              <h3 className={styles.h3}>{selected.name}</h3>
              <dl className={styles.meta}>
                <dt>id</dt>
                <dd><code>{selected.id}</code></dd>
                <dt>created</dt>
                <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
              </dl>
            </>
          ) : (
            <p className={styles.muted}>Select a project to see its detail.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
