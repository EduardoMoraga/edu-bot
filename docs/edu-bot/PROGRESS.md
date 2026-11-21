# Edu Bot: avance

Hecho = verificado. Cada línea dice cómo se probó.

## Estado de los hitos

| Hito | Qué es | Estado |
| --- | --- | --- |
| M0 | El repo instala, compila y pasa tests en Linux | En curso |
| M1 | Nombre Edu Bot, licencias, sin telemetría, sin `enterprise/` | En curso (plan listo) |
| M2 | Memoria Edu en cada bot, con aprobaciones | Pendiente |
| M3 | Organización, áreas y bots en archivos | Pendiente |
| M4 | Conector SQL, permisos por bot, registro de auditoría | Pendiente |
| M5 | CI en 3 sistemas, instaladores, README, versión 0.1.0 | Pendiente |
| M6 | Auditoría final con dos proveedores | Pendiente |

## M0: salud del repo

- [x] Push a `upstream` bloqueado en este equipo.
- [x] Dependencias instaladas con pnpm 10.33.0 y Node 26.
- [x] Typecheck sin errores (`pnpm typecheck`).
- [x] Lint sin errores (`pnpm lint`).
- [ ] Build (`pnpm build`). Falló por falta de memoria de Node (límite 2 GB en este equipo).
  Arreglo: el build usa 4 GB, igual que el release.
- [ ] Tests unitarios (`vitest run`).
- [ ] La app abre en Linux.
- [ ] Auditoría de otro proveedor.

## Cómo trabajamos

- Líder: Claude (este agente). Backend: Claude. Interfaz: Codex. Auditores: Grok y Antigravity.
- Cada agente tiene su copia del repo en `~/Projects/edu-bot-wt/<rol>`.
- Encargos en `~/Projects/edu-bot-wt/briefs/`. Reportes en `~/Projects/edu-bot-wt/reports/`.

## Decisiones

- Se quita PostHog completo. No queda ninguna analítica.
- `server/enterprise.ts` queda como pieza vacía (edición "oss"). Se borra la carpeta `enterprise/`.
- Puerto 8799 y variables `OMB_*` se mantienen por ahora.
- Carpeta de datos nueva: `~/.edubot`. Esquema de enlaces: `edubot://`.
- El bot ayudante se llama "Edu".

## Para el lanzamiento (M5)

- No incluir en los instaladores binarios con licencia que prohíbe redistribuir:
  herramientas Android de Google y Chrome for Testing. Revisarlo en M5.

## Necesito de Eduardo

Nada por ahora.
