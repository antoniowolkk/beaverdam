import { readFile, rm } from "node:fs/promises";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { OWNER_URL, PG_PORT } from "./db-urls.js";

export default async function setup() {
  await rm(".pgdata", { recursive: true, force: true });
  const server = new EmbeddedPostgres({
    databaseDir: ".pgdata",
    user: "postgres",
    password: "postgres",
    port: PG_PORT,
    persistent: false,
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase("demo");

  const owner = new pg.Client({ connectionString: OWNER_URL });
  await owner.connect();
  await owner.query(`CREATE ROLE app_user LOGIN PASSWORD 'app_user_local'`);
  await owner.query(await readFile("migrations/001_init.sql", "utf8"));
  await owner.end();

  return async () => {
    await server.stop();
  };
}
