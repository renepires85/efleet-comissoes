-- IDs rastreáveis legíveis: PREFIXO-AAAAMM-NNN
--
-- Decisões tomadas aqui:
--
-- 1. Contador em tabela própria com INSERT..ON CONFLICT DO UPDATE RETURNING,
--    que é atômico e trava a linha. Um trigger com max(codigo)+1 teria condição
--    de corrida: o processar_comissoes insere dezenas de linhas em loop e duas
--    execuções simultâneas gerariam código duplicado — que, sendo unique,
--    derrubaria o cálculo inteiro.
--
-- 2. A competência (AAAAMM) vem do período de negócio, não da data de criação,
--    onde isso existe. Um fechamento de junho enviado em julho é FCH-202606,
--    porque é assim que a gestão se refere a ele no dia a dia.
--
-- 3. prestadores entra no esquema (o roadmap não listava), com prefixo por
--    tipo: VND para vendedor, IND para indicador. A coluna codigo já existia
--    mas nunca foi preenchida — 0 de 15 registros — e a antiga
--    gerar_codigo_prestador usava outro formato (VND0001), então não há
--    migração de dado a fazer, só a troca do formato.
--
-- 4. lpad com 3 dígitos não trunca: se um mês passar de 999, o código fica
--    com 4 dígitos e continua único, em vez de falhar.

-- ── Contador ──────────────────────────────────────────────────────────────────
create table if not exists public.codigo_contadores (
  prefixo     text not null,
  competencia text not null,
  ultimo      integer not null default 0,
  primary key (prefixo, competencia)
);

alter table public.codigo_contadores enable row level security;

drop policy if exists "codigo_contadores: gestao le" on public.codigo_contadores;
create policy "codigo_contadores: gestao le" on public.codigo_contadores
  for select using (public.meu_perfil() = 'gestao');

-- ── Gerador ───────────────────────────────────────────────────────────────────
create or replace function public.proximo_codigo(p_prefixo text, p_data date default current_date)
returns text
language plpgsql
security definer
as $function$
declare
  v_comp text := to_char(coalesce(p_data, current_date), 'YYYYMM');
  v_seq  integer;
begin
  insert into public.codigo_contadores (prefixo, competencia, ultimo)
  values (p_prefixo, v_comp, 1)
  on conflict (prefixo, competencia)
  do update set ultimo = public.codigo_contadores.ultimo + 1
  returning ultimo into v_seq;

  return p_prefixo || '-' || v_comp || '-' || lpad(v_seq::text, 3, '0');
end;
$function$;

-- ── Trigger genérico ──────────────────────────────────────────────────────────
-- Argumentos: [0] prefixo fixo, ou vazio para prestadores (prefixo por tipo);
--             [1] coluna de data usada como competência.
create or replace function public.trg_preencher_codigo()
returns trigger
language plpgsql
as $function$
declare
  v_prefixo text := tg_argv[0];
  v_coluna  text := tg_argv[1];
  v_data    date;
begin
  if new.codigo is not null then
    return new;
  end if;

  execute format('select ($1.%I)::date', v_coluna) into v_data using new;

  -- prestadores: o prefixo depende do tipo de parceiro (VND hoje, IND depois)
  if v_prefixo = '' then
    v_prefixo := case
      when to_jsonb(new) ? 'tipo_parceiro' and to_jsonb(new)->>'tipo_parceiro' = 'indicador'
        then 'IND'
      else 'VND'
    end;
  end if;

  new.codigo := public.proximo_codigo(v_prefixo, v_data);
  return new;
end;
$function$;

-- ── Colunas ───────────────────────────────────────────────────────────────────
alter table public.usuarios   add column if not exists codigo text;
alter table public.uploads    add column if not exists codigo text;
alter table public.comissoes  add column if not exists codigo text;

-- ── Triggers ──────────────────────────────────────────────────────────────────
drop trigger if exists set_codigo on public.usuarios;
create trigger set_codigo before insert on public.usuarios
  for each row execute function public.trg_preencher_codigo('USR', 'criado_em');

drop trigger if exists set_codigo on public.uploads;
create trigger set_codigo before insert on public.uploads
  for each row execute function public.trg_preencher_codigo('FCH', 'periodo_fim');

drop trigger if exists set_codigo on public.comissoes;
create trigger set_codigo before insert on public.comissoes
  for each row execute function public.trg_preencher_codigo('CAL', 'periodo_fim');

drop trigger if exists set_codigo on public.prestadores;
create trigger set_codigo before insert on public.prestadores
  for each row execute function public.trg_preencher_codigo('', 'criado_em');

-- ── Backfill dos registros existentes ─────────────────────────────────────────
-- Em ordem cronológica, para que a numeração reflita a ordem real dos fatos.
do $backfill$
declare r record;
begin
  for r in select id, criado_em from public.usuarios where codigo is null order by criado_em loop
    update public.usuarios set codigo = public.proximo_codigo('USR', r.criado_em::date) where id = r.id;
  end loop;

  for r in select id, periodo_fim from public.uploads where codigo is null order by criado_em loop
    update public.uploads set codigo = public.proximo_codigo('FCH', r.periodo_fim) where id = r.id;
  end loop;

  for r in select id, periodo_fim from public.comissoes where codigo is null order by criado_em, cliente_nome, produto loop
    update public.comissoes set codigo = public.proximo_codigo('CAL', r.periodo_fim) where id = r.id;
  end loop;

  for r in select id, criado_em from public.prestadores where codigo is null order by criado_em loop
    update public.prestadores set codigo = public.proximo_codigo('VND', r.criado_em::date) where id = r.id;
  end loop;
end
$backfill$;

-- ── Unicidade (depois do backfill, senão o índice barra o preenchimento) ──────
create unique index if not exists idx_usuarios_codigo    on public.usuarios    (codigo);
create unique index if not exists idx_uploads_codigo     on public.uploads     (codigo);
create unique index if not exists idx_comissoes_codigo   on public.comissoes   (codigo);
create unique index if not exists idx_prestadores_codigo on public.prestadores (codigo);

-- A antiga gerar_codigo_prestador gerava VND0001, formato abandonado aqui.
drop function if exists public.gerar_codigo_prestador(text);
