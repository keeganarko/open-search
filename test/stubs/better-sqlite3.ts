/**
 * `store/db.ts` opens nothing at import time, so a constructor that throws is
 * enough: it keeps the module graph loadable while making an accidental query
 * in a test loud instead of silent.
 */
export default class Database {
  constructor() {
    throw new Error('better-sqlite3 is stubbed in tests — do not open the database')
  }
}
