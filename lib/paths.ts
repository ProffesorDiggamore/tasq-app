import path from 'node:path';

/**
 * Everything resolves off the project root rather than process.cwd() at call
 * time, so launchd can start the server from any working directory.
 */
export const PROJECT_ROOT = process.env.TASQ_ROOT ?? process.cwd();
/**
 * Overridable separately from TASQ_ROOT for the Mac app bundle: the code and
 * migrations ship inside Tasq.app while the data lives in ~/Library/Application
 * Support/Tasq, so updating the app never touches a shop's database.
 */
export const DATA_DIR = process.env.TASQ_DATA_DIR ?? path.join(PROJECT_ROOT, 'data');
/** Overridable so a test run, or a second data disk, never touches the live file. */
export const DB_PATH =
  process.env.TASQ_DB_PATH ?? path.join(DATA_DIR, 'tasq.db');
export const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'drizzle');
export const BACKUPS_DIR =
  process.env.TASQ_BACKUPS_DIR ?? path.join(PROJECT_ROOT, 'backups');
