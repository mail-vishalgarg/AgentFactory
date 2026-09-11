# Coding Rules

## Backend (FastAPI)

1. **Routers are thin** — a router function does: validate input, call one service function, return the result. No business logic in routers.
2. **Logic lives in services** — `app/services/` contains all domain logic. Services are plain functions or classes with no FastAPI imports.
3. **Pydantic for all I/O** — every request body, response body, and config value uses a Pydantic model. No `dict` passing across layer boundaries.
4. **Typed Python everywhere** — every function signature has return type; `mypy --strict` must pass.
5. **Database access in repositories** — raw SQLAlchemy queries live in `app/repositories/`, not services.

## Frontend (React + TypeScript)

1. **Small, typed components** — components under 100 lines; props always typed with `interface`.
2. **No `any`** — `strict: true` in tsconfig; never cast to `any`.
3. **Co-locate styles** — use Tailwind utility classes inline; avoid separate CSS files per component.
4. **API calls in hooks** — network requests go in custom hooks (`useXxx`), not directly in components.

## General

- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:` prefixes.
- **Tests for every service** — add a `tests/` file mirroring each service file.
- **No half-finished code** — every merged commit leaves the app in a working state.
