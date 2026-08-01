create table if not exists investigations (
  id            uuid primary key,
  title         text not null,
  video_name    text,
  duration_sec  numeric,
  frame_count   int  not null default 0,
  summary       text,
  created_at    timestamptz not null default now()
);

create table if not exists keyframes (
  id                serial primary key,
  investigation_id  uuid not null references investigations(id) on delete cascade,
  idx               int  not null,
  t_sec             numeric not null,
  thumb             text,
  unique (investigation_id, idx)
);

create table if not exists ocr_results (
  id                serial primary key,
  investigation_id  uuid not null references investigations(id) on delete cascade,
  frame_idx         int  not null,
  text              text,
  confidence        numeric
);

create table if not exists clues (
  id                serial primary key,
  investigation_id  uuid not null references investigations(id) on delete cascade,
  frame_idx         int  not null,
  kind              text not null,
  value             text not null,
  rationale         text
);

create table if not exists candidate_locations (
  id                serial primary key,
  investigation_id  uuid not null references investigations(id) on delete cascade,
  rank              int  not null,
  label             text not null,
  country           text,
  admin             text,
  lat               double precision not null,
  lon               double precision not null,
  confidence        numeric not null,
  band              text not null,
  precision_level   text not null
);

create table if not exists analyses (
  id                serial primary key,
  investigation_id  uuid not null references investigations(id) on delete cascade,
  reasoning         jsonb not null,
  created_at        timestamptz not null default now()
);

create index if not exists idx_kf_inv on keyframes(investigation_id);
create index if not exists idx_cl_inv on clues(investigation_id);
create index if not exists idx_cand_inv on candidate_locations(investigation_id);
