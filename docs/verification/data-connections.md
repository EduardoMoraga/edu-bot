# Named data connections

A bot reads a named connection with `data_sql` and `on`. A write uses `data_write` and waits for an approval card, including at Full access. The password is stored in the Vault. A tool given a `postgres://` URL is refused, and the URL is not repeated.

The isolated check is `server/data/data-connections.e2e.test.ts`. It launches a fixture, answers one SQLite table, refuses another, and approves or denies a write. Postgres runs only when `EDUBOT_PG_TEST_URL` is set.

Do not point this at a live app. The fixture's data directory is removed when the test ends.
