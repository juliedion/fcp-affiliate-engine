create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source_url text,
  name text not null,
  category text,
  score integer,
  cost numeric(12,2),
  price numeric(12,2),
  margin numeric(8,2),
  status text not null default 'idea',
  payload jsonb not null default '{}'::jsonb
);
alter table products enable row level security;
create policy "authenticated users manage products" on products for all to authenticated using (true) with check (true);
