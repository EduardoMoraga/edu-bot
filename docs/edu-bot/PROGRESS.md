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
- [x] Build (`pnpm build`): pasa en 47 s. Antes fallaba por falta de memoria de Node
  (límite 2 GB en este equipo). Arreglo: el build usa 4 GB, igual que el release. PR #1.
- [x] Electron no se había descargado al instalar. Se bajó con `node install.js` del paquete electron.
- [ ] Tests unitarios (`vitest run`): corren en 8 partes, una tras otra, para no llenar la memoria.
  Hallazgo: `/tmp` vive en la RAM. Los tests dejaron 4,7 GB ahí. Eso causó gran parte del corte.
  Ahora los tests usan una carpeta temporal en disco (`TMPDIR=~/.cache/edubot-test-tmp`).
- [x] Con Node 26, 2 archivos de tests de interfaz fallaban: Node trae su propio `localStorage` vacío.
  Arreglo en `vite.config.ts` (`--no-experimental-webstorage`). Los 15 tests pasan.
- [ ] La app abre en Linux.
- [ ] Auditoría de otro proveedor.

## Cómo trabajamos

- Regla de memoria (12 GB): máximo 2 agentes a la vez, el líder y 1 trabajador.
  Auditorías de Grok y Agy, una después de la otra. Build y tests en primer plano con 4 GB.
- El 21-11 a las 00:39 el sistema cortó todo por memoria. Se perdió el avance de Codex, Grok y Agy.
  Su trabajo quedó guardado en sus carpetas. M1 queda en pausa hasta cerrar M0.
- Cerré 7 agentes inactivos de otros proyectos para liberar memoria. Sus sesiones se pueden reabrir:
  la lista está en `~/Projects/edu-bot-wt/reports/closed-idle-agents.txt`.

- Líder: Claude (este agente). Backend: Claude. Interfaz: Codex. Auditores: Grok y Antigravity.
- Cada agente tiene su copia del repo en `~/Projects/edu-bot-wt/<rol>`.
- Encargos en `~/Projects/edu-bot-wt/briefs/`. Reportes en `~/Projects/edu-bot-wt/reports/`.

## Decisiones

- Se quita PostHog completo. No queda ninguna analítica.
- `server/enterprise.ts` queda como pieza vacía (edición "oss"). Se borra la carpeta `enterprise/`.
- Puerto 8799 y variables `OMB_*` se mantienen por ahora.
- Carpeta de datos nueva: `~/.edubot`. Esquema de enlaces: `edubot://`.
- El bot ayudante se llama "Edu".

## GitHub Actions

- Eduardo activó Actions en el fork (21-11).
- Solo quedan activos 2 workflows: "CI" y "Stop CI for closed PRs".
- Desactivé 18 workflows de upstream (Release, Docker, Promote to stable, npm, etc.).
  No aplican aún o fallarían por secretos que no tenemos. Se reactivan en M5 con
  `gh workflow enable <nombre>` cuando estén adaptados a Edu Bot.

## Para el lanzamiento (M5)

- No incluir en los instaladores binarios con licencia que prohíbe redistribuir:
  herramientas Android de Google y Chrome for Testing. Revisarlo en M5.

## Necesito de Eduardo

1. **Memoria del equipo.** Con 12 GB y 5 agentes, el sistema corta los procesos largos.
   Opcional: iniciar Claude Code con `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1`,
   o cerrar las otras sesiones de agentes que no uses.
