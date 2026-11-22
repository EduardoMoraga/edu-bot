# Named data connections

A bot reads a named connection with `data_sql` and `on`. This release does not write. The password stays in the Vault and is never given to a bot. A tool given a `postgres://` URL is refused, and the URL is not repeated.

The isolated check is `server/data/data-connections.e2e.test.ts`. It launches a fixture, answers one SQLite table, and refuses another table and an insert. Postgres runs only when `EDUBOT_PG_TEST_URL` is set.

Do not point this at a live app. The fixture's data directory is removed when the test ends.
