import type { Db } from './index.js';

export interface User {
  id: number;
  email: string;
  created_at: number;
}

/**
 * Magic-link consumption doubles as registration: an unknown address creates
 * the account rather than being turned away to find a sign-up form.
 */
export async function findOrCreateUser(db: Db, email: string): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const found = await db.execute({
    sql: 'select id, email, created_at from users where email = ?',
    args: [normalized],
  });
  if (found.rows.length) return found.rows[0] as unknown as User;

  await db.execute({
    sql: 'insert into users (email, created_at) values (?, ?)',
    args: [normalized, Date.now()],
  });
  const created = await db.execute({
    sql: 'select id, email, created_at from users where email = ?',
    args: [normalized],
  });
  return created.rows[0] as unknown as User;
}

export async function getUserById(db: Db, id: number): Promise<User | null> {
  const r = await db.execute({
    sql: 'select id, email, created_at from users where id = ?',
    args: [id],
  });
  return (r.rows[0] as unknown as User) ?? null;
}
