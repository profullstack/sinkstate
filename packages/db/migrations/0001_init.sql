create table if not exists users (
  id integer primary key autoincrement,
  email text not null unique,
  created_at integer not null
);

create table if not exists sessions (
  id integer primary key autoincrement,
  user_id integer not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at integer not null,
  expires_at integer not null
);

create index if not exists sessions_user_idx on sessions(user_id);

create table if not exists login_tokens (
  id integer primary key autoincrement,
  email text not null,
  token_hash text not null unique,
  created_at integer not null,
  expires_at integer not null,
  consumed_at integer
);

create table if not exists passkeys (
  id integer primary key autoincrement,
  user_id integer not null references users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter integer not null default 0,
  transports text,
  created_at integer not null
);

create index if not exists passkeys_user_idx on passkeys(user_id);
