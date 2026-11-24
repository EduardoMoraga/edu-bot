# Named data connections

A bot reads a named connection with `data_sql` and `on`. This release does not write. The password stays in the Vault and is never given to a bot. A tool given a `postgres://` URL is refused, and the URL is not repeated.

The isolated check is `server/data/data-connections.e2e.test.ts`. It launches a fixture, answers one SQLite table, and refuses another table and an insert. Postgres runs only when `EDUBOT_PG_TEST_URL` is set.

Do not point this at a live app. The fixture's data directory is removed when the test ends.

## Known limits

The table allowlist is the hard boundary for named connections. The local data tools (`data_load`, and `data_sql`, `data_describe`, `data_show` and `data_export` without `on`) read files with the app's rights, like the bot's terminal. They refuse a path whose real location is a connection's database file, inside a folder allowed for connections, or inside Edu Bot's data folder (except the bots' working folders and attachments); a SQL read whose path is not a plain string is refused too. Every other file the bot can reach stays readable, with no approval card. The check is `server/data/local-files.test.ts`.
