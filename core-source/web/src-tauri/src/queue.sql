PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(
 id TEXT PRIMARY KEY,store_id TEXT NOT NULL,printer TEXT NOT NULL,width INTEGER NOT NULL CHECK(width IN(58,80)),
 receipt TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN('queued','printing','submitted','error','uncertain')),
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,error TEXT,
 spool_id INTEGER,created_at INTEGER NOT NULL DEFAULT(unixepoch()),updated_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(store_id,state,next_attempt);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, job_id TEXT NOT NULL,action TEXT NOT NULL,at INTEGER NOT NULL DEFAULT(unixepoch()));
