import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { RootLayout } from "./RootLayout.js";
import { App } from "../App.js";
import { ProjectsPanel } from "../poc/ProjectsPanel.js";

// Code-based route tree (kept in one file for reviewability; TanStack Router
// also supports file-based routing). Every path/param/search is fully typed off
// this tree — a great fit for the already-typed API (openapi-fetch) + Fastify/Zod.

const rootRoute = createRootRoute({ component: RootLayout });

// "/" — the existing KMBO-252 vertical slice, untouched (the "before").
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: App,
});

// "/poc" — the new stack (the "after").
const pocRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/poc",
  component: ProjectsPanel,
});

const routeTree = rootRoute.addChildren([indexRoute, pocRoute]);

export const router = createRouter({ routeTree });

// Registers the router type globally so <Link to="..."> is autocompleted/checked.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
