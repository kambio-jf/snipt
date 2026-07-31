import { Link, Outlet } from "@tanstack/react-router";
import styles from "./RootLayout.module.scss";

// This is the "templating/layout system" you asked about. React has no template
// language — a layout is just a component that renders shared chrome plus an
// <Outlet/> where the matched child route paints. Nest more layout routes and
// you get section- and page-level layouts the same way.
export function RootLayout() {
  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <span className={styles.brand}>Video Tools</span>
        <nav className={styles.nav}>
          <Link to="/" className={styles.link} activeProps={{ className: styles.active }}>
            Vertical slice (before)
          </Link>
          <Link to="/poc" className={styles.link} activeProps={{ className: styles.active }}>
            React POC (after)
          </Link>
        </nav>
      </header>
      <div className={styles.main}>
        <Outlet />
      </div>
    </div>
  );
}
