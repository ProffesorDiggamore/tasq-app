import path from 'node:path';

/**
 * Everything resolves off the project root rather than process.cwd() at call
 * time, so launchd can start the server from any working directory.
 */
export const PROJECT_ROOT = process.env.APEX_ROOT ?? process.cwd();
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
/** Overridable so a test run, or a second data disk, never touches the live file. */
export const DB_PATH = process.env.APEX_DB_PATH ?? path.join(DATA_DIR, 'apex.db');
export const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'drizzle');
export const BACKUPS_DIR = path.join(PROJECT_ROOT, 'backups');
