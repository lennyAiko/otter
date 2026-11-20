-- Runs only when the otter_pgdata volume is empty (first start).
-- To re-seed from scratch: docker compose down -v && docker compose up -d

create schema if not exists billing;

create table public.users (
  id         serial primary key,
  name       text not null,
  email      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.users (id, name, email, is_active, created_at) values
  (1,  'Ada Okafor',     'ada.okafor@example.com',     true,  '2026-01-03 09:10'),
  (2,  'Tunde Bello',    'tunde.bello@example.com',    true,  '2026-02-05 09:13'),
  (3,  'Chioma Eze',     'chioma.eze@example.com',     true,  '2026-03-07 09:16'),
  (4,  'Femi Adeyemi',   'femi.adeyemi@example.com',   false, '2026-04-09 09:19'),
  (5,  'Grace Musa',     'grace.musa@example.com',     true,  '2026-05-11 09:22'),
  (6,  'Ibrahim Sani',   'ibrahim.sani@example.com',   true,  '2026-06-13 09:25'),
  (7,  'Kemi Johnson',   null,                         true,  '2026-07-15 09:28'),
  (8,  'Lola Ade',       'lola.ade@example.com',       false, '2026-08-17 09:31'),
  (9,  'Musa Danjuma',   'musa.danjuma@example.com',   true,  '2026-09-19 09:34'),
  (10, 'Ngozi Obi',      'ngozi.obi@example.com',      true,  '2026-01-21 09:37'),
  (11, 'Segun Alabi',    'segun.alabi@example.com',    true,  '2026-02-23 09:40'),
  (12, 'Zainab Yusuf',   'zainab.yusuf@example.com',   false, '2026-03-25 09:43');

create table public.orders (
  id         serial primary key,
  user_id    integer not null references public.users (id),
  total      numeric(10, 2) not null,
  status     text not null,
  created_at timestamptz not null default now()
);

insert into public.orders (id, user_id, total, status, created_at) values
  (1001,  1, 15.00, 'pending', '2026-11-02 10:20'),
  (1002,  6, 22.35, 'paid',    '2026-11-03 11:20'),
  (1003, 11, 29.70, 'shipped', '2026-11-04 12:20'),
  (1004,  4, 37.05, 'pending', '2026-11-05 13:20'),
  (1005,  9, 44.40, 'paid',    '2026-11-06 14:20'),
  (1006,  2, 51.75, 'shipped', '2026-11-07 15:20'),
  (1007,  7, 59.10, 'pending', '2026-11-08 16:20'),
  (1008, 12, 66.45, 'paid',    '2026-11-09 17:20'),
  (1009,  5, 73.80, 'shipped', '2026-11-10 18:20'),
  (1010, 10, 81.15, 'pending', '2026-11-11 19:20');

-- Deliberately has no primary key: exercises the read-only grid path.
create table public.audit_log (
  event text not null,
  actor text not null,
  at    timestamptz not null
);

insert into public.audit_log (event, actor, at) values
  ('login',        'ada.okafor',   '2026-11-17 08:02'),
  ('update_order', 'tunde.bello',  '2026-11-17 09:15'),
  ('logout',       'ada.okafor',   '2026-11-17 12:40'),
  ('login',        'grace.musa',   '2026-11-17 13:05');

create table billing.invoices (
  id       serial primary key,
  order_id integer not null references public.orders (id),
  amount   numeric(10, 2) not null,
  paid     boolean not null default false
);

insert into billing.invoices (id, order_id, amount, paid) values
  (1, 1001, 15.00, true),
  (2, 1002, 22.35, false),
  (3, 1004, 37.05, true),
  (4, 1007, 59.10, false);

select setval(pg_get_serial_sequence('public.users', 'id'), 12);
select setval(pg_get_serial_sequence('public.orders', 'id'), 1010);
select setval(pg_get_serial_sequence('billing.invoices', 'id'), 4);
