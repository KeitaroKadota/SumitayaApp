-- 0006 CMN-02 祝日・休業日(holidays)。1行=1日(会社全体の暦。店舗・工場で同じ)
-- 設計書: CMN-02 01 6.6(列)・03 EV-17〜EV-21・04 CH-26〜CH-28、00_共通設計 1章・7.5
-- 0005 の後に1回だけ実行する。行は画面の「この年の休日を作る」で作る(ここでは入れない)。
-- 日付の列は 00_共通設計 7.5 の決まり(date の列は _on)に合わせて holiday_on とした(設計書 6.6 は date)。

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_on date not null unique,
  name text not null check (char_length(name) between 1 and 50),
  -- 祝日・定休日・臨時休業／臨時営業
  kind text not null check (kind in ('national', 'regular', 'temporary')),
  -- その日を休業日とするか。定休日でも営業する日は false(臨時営業)
  is_closed boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 自動で作った行は空
  created_by uuid references public.employees (id),
  updated_by uuid references public.employees (id)
);

create trigger holidays_set_updated_at
before update on public.holidays
for each row execute function public.set_updated_at();

alter table public.holidays enable row level security;
