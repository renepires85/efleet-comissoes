-- Parceiro Indicador — Etapa 1 + cálculo.
--
-- Decisão de arquitetura (registrada em memória do projeto): reusar
-- `prestadores` com uma coluna discriminadora `tipo_parceiro`, em vez da
-- tabela `parceiros_indicadores` separada do roadmap original. Isso
-- reaproveita pagamento, validação, extrato e dados bancários que já
-- existem para vendedor.
--
-- O vínculo cliente→indicador foi conferido empiricamente no arquivo
-- histórico do BI (14.861 linhas, 2010-2026): é estável por CNPJ — nenhum
-- dos 38 clientes com indicador trocou de indicador ao longo do tempo.
-- Por isso vira uma tabela própria (`clientes_indicadores`), gerida pela
-- gestão, em vez de depender da coluna "Indicador" estar sempre presente
-- e correta em todo arquivo mensal do BI.

-- ── 1. usuarios: liberar o perfil 'indicador' ─────────────────────────────────
alter table public.usuarios drop constraint if exists usuarios_perfil_check;
alter table public.usuarios add constraint usuarios_perfil_check
  check (perfil = any (array['gestao','financeiro','vendedor','indicador']));

-- ── 2. prestadores: discriminador de tipo ─────────────────────────────────────
-- A função trg_preencher_codigo (migration de IDs rastreáveis) já checa
-- tipo_parceiro='indicador' para gerar prefixo IND — não precisa mudar.
alter table public.prestadores add column if not exists tipo_parceiro text not null default 'vendedor';
alter table public.prestadores drop constraint if exists prestadores_tipo_parceiro_check;
alter table public.prestadores add constraint prestadores_tipo_parceiro_check
  check (tipo_parceiro in ('vendedor','indicador'));

-- ── 3. contratos_indicadores ───────────────────────────────────────────────────
create table if not exists public.contratos_indicadores (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text,
  prestador_id         uuid not null references public.prestadores(id) on delete cascade,
  percentual_comissao  numeric not null default 0 check (percentual_comissao >= 0 and percentual_comissao <= 100),
  periodo_recorrencia  integer not null default 12 check (periodo_recorrencia > 0),
  produtos_elegiveis   text[] not null default '{}'
    check (produtos_elegiveis <@ array['FUEL','PASS','FINES','PREMIUM']::text[]),
  data_inicio          date not null default current_date,
  contrato_pdf_url     text,
  status               text not null default 'pendente' check (status in ('pendente','ativo','encerrado')),
  criado_em            timestamptz not null default now()
);

alter table public.contratos_indicadores enable row level security;

drop trigger if exists set_codigo on public.contratos_indicadores;
create trigger set_codigo before insert on public.contratos_indicadores
  for each row execute function public.trg_preencher_codigo('CTR', 'data_inicio');

drop policy if exists "contratos_indicadores: gestao tudo" on public.contratos_indicadores;
create policy "contratos_indicadores: gestao tudo" on public.contratos_indicadores
  for all using (public.meu_perfil() = 'gestao') with check (public.meu_perfil() = 'gestao');

drop policy if exists "contratos_indicadores: indicador ve o proprio" on public.contratos_indicadores;
create policy "contratos_indicadores: indicador ve o proprio" on public.contratos_indicadores
  for select using (prestador_id = public.meu_prestador_id());

-- Mesmo padrão de grants de prestadores (authenticated: CRUD sem delete via
-- RLS; anon: só a base para RLS operar). Tabelas criadas sem "Automatically
-- expose new tables" não recebem isso por padrão — é a mesma armadilha que
-- pegou o service_role em 2026-07-16.
grant select, insert, update, references, trigger, truncate on public.contratos_indicadores to authenticated;
grant select, references, trigger, truncate on public.contratos_indicadores to anon;

-- ── 4. clientes_indicadores (o vínculo, gerido pela gestão) ────────────────────
create table if not exists public.clientes_indicadores (
  cliente_cnpj  text primary key,
  indicador_id  uuid not null references public.prestadores(id) on delete cascade,
  criado_em     timestamptz not null default now()
);

alter table public.clientes_indicadores enable row level security;

drop policy if exists "clientes_indicadores: gestao tudo" on public.clientes_indicadores;
create policy "clientes_indicadores: gestao tudo" on public.clientes_indicadores
  for all using (public.meu_perfil() = 'gestao') with check (public.meu_perfil() = 'gestao');

drop policy if exists "clientes_indicadores: indicador ve o proprio" on public.clientes_indicadores;
create policy "clientes_indicadores: indicador ve o proprio" on public.clientes_indicadores
  for select using (indicador_id = public.meu_prestador_id());

grant select, insert, update, references, trigger, truncate on public.clientes_indicadores to authenticated;
grant select, references, trigger, truncate on public.clientes_indicadores to anon;

-- ── 5. comissoes: um vendedor E um indicador podem ganhar no mesmo fechamento ──
-- A constraint antiga (fechamento_id, produto) impediria a segunda linha.
alter table public.comissoes drop constraint if exists uq_comissao_unica;
alter table public.comissoes add constraint uq_comissao_unica
  unique (fechamento_id, produto, prestador_id);

-- ── 6. Cálculo da comissão do indicador ────────────────────────────────────────
-- fator_ramp = 1 sempre: o indicador recebe o percentual cheio do contrato
-- desde o mês 1, sem rampa — é uma taxa de indicação, não um incentivo de
-- ramp-up como o do vendedor. periodo_recorrencia usa a MESMA âncora que a
-- Curva C do vendedor (mes_curva já calculado a partir da ativação do
-- produto para aquele cliente), não a data de início do contrato do
-- indicador — assim o prazo é sobre o cliente, igual para todo indicador.
create or replace function public.inserir_comissao_indicador(
  p_fechamento_id  uuid,
  p_periodo_inicio date,
  p_periodo_fim    date,
  p_cliente_cnpj   text,
  p_cliente_nome   text,
  p_produto        text,
  p_data_ativacao  date,
  p_mes_curva      int,
  p_base_calculo   numeric,
  p_status_cliente text
)
returns void
language plpgsql
security definer
as $function$
declare
  v_indicador_id uuid;
  v_contrato     record;
  v_taxa         numeric;
  v_comissao     numeric;
  v_status       text;
begin
  select ci.indicador_id into v_indicador_id
  from public.clientes_indicadores ci
  where ci.cliente_cnpj = p_cliente_cnpj;

  if v_indicador_id is null then
    return;
  end if;

  select * into v_contrato
  from public.contratos_indicadores
  where prestador_id = v_indicador_id and status = 'ativo'
  order by data_inicio desc
  limit 1;

  if v_contrato is null then
    return;
  end if;

  if not (p_produto = any(v_contrato.produtos_elegiveis)) then
    return;
  end if;

  if p_mes_curva > v_contrato.periodo_recorrencia then
    return;
  end if;

  v_taxa     := v_contrato.percentual_comissao / 100.0;
  v_comissao := p_base_calculo * v_taxa;
  v_status   := case
    when p_status_cliente = 'churn'        then 'zerada'
    when p_status_cliente = 'inadimplente' then 'suspensa'
    else 'calculada' end;

  insert into public.comissoes (
    fechamento_id, prestador_id, periodo_inicio, periodo_fim,
    cliente_cnpj, cliente_nome, produto, data_ativacao,
    mes_curva, fator_ramp, base_calculo, taxa_comissao, comissao_bruta, status
  ) values (
    p_fechamento_id, v_indicador_id, p_periodo_inicio, p_periodo_fim,
    p_cliente_cnpj, p_cliente_nome, p_produto, p_data_ativacao,
    p_mes_curva, 1.0, p_base_calculo, v_taxa, v_comissao, v_status
  ) on conflict do nothing;
end;
$function$;

-- ── 7. processar_comissoes: chama o helper após cada produto do vendedor ──────
-- Idêntica à versão de 2026-07-15 (match por nome em 3 níveis), só com a
-- chamada a inserir_comissao_indicador acrescentada em cada um dos 4 blocos.
create or replace function public.processar_comissoes(p_upload_id uuid)
 returns integer
 language plpgsql
 security definer
as $function$
declare
  rec          record;
  v_mes_curva  int;
  v_fator_ramp numeric;
  v_comissao   numeric;
  v_status     text;
  v_count      int := 0;
begin
  for rec in
    select f.*, m.p_id
    from   public.fechamentos f
    join lateral (
      select p.id as p_id
      from (
        select p1.id, 1 as prio
        from public.prestadores p1
        where lower(trim(p1.nome)) = lower(trim(f.vendedor_nome))
        union all
        select p2.id, 2
        from (
          select px.id, count(*) over () as qtd
          from public.prestadores px
          where lower(px.nome) like '%' || lower(trim(f.vendedor_nome)) || '%'
        ) p2
        where p2.qtd = 1
        union all
        select p3.id, 3
        from (
          select px.id, count(*) over () as qtd
          from public.prestadores px
          where (select bool_and(lower(px.nome) like '%' || w || '%')
                 from unnest(string_to_array(lower(trim(f.vendedor_nome)), ' ')) as w)
        ) p3
        where p3.qtd = 1
      ) p
      order by p.prio
      limit 1
    ) m on true
    where  f.upload_id = p_upload_id
      and  trim(coalesce(f.vendedor_nome, '')) <> ''
  loop
    if rec.ativacao_fuel is not null and rec.receita_fuel is not null then
      v_mes_curva  := public.calcular_mes_curva(rec.ativacao_fuel, rec.periodo_fim);
      v_fator_ramp := public.calcular_fator_ramp(v_mes_curva);
      v_comissao   := rec.receita_fuel * 0.20 * v_fator_ramp;
      v_status     := case
        when rec.status_cliente = 'churn'        then 'zerada'
        when rec.status_cliente = 'inadimplente' then 'suspensa'
        when v_fator_ramp = 0                    then 'zerada'
        else 'calculada' end;
      insert into public.comissoes (
        fechamento_id, prestador_id, periodo_inicio, periodo_fim,
        cliente_cnpj, cliente_nome, produto, data_ativacao,
        mes_curva, fator_ramp, base_calculo, taxa_comissao, comissao_bruta, status
      ) values (
        rec.id, rec.p_id, rec.periodo_inicio, rec.periodo_fim,
        rec.cliente_cnpj, rec.cliente_nome, 'FUEL', rec.ativacao_fuel,
        v_mes_curva, v_fator_ramp, rec.receita_fuel, 0.20, v_comissao, v_status
      ) on conflict do nothing;
      v_count := v_count + 1;
      perform public.inserir_comissao_indicador(
        rec.id, rec.periodo_inicio, rec.periodo_fim, rec.cliente_cnpj, rec.cliente_nome,
        'FUEL', rec.ativacao_fuel, v_mes_curva, rec.receita_fuel, rec.status_cliente
      );
    end if;
    if rec.ativacao_pass is not null and rec.receita_pass is not null then
      v_mes_curva  := public.calcular_mes_curva(rec.ativacao_pass, rec.periodo_fim);
      v_fator_ramp := public.calcular_fator_ramp(v_mes_curva);
      v_comissao   := rec.receita_pass * 0.15 * v_fator_ramp;
      v_status     := case
        when rec.status_cliente = 'churn'        then 'zerada'
        when rec.status_cliente = 'inadimplente' then 'suspensa'
        when v_fator_ramp = 0                    then 'zerada'
        else 'calculada' end;
      insert into public.comissoes (
        fechamento_id, prestador_id, periodo_inicio, periodo_fim,
        cliente_cnpj, cliente_nome, produto, data_ativacao,
        mes_curva, fator_ramp, base_calculo, taxa_comissao, comissao_bruta, status
      ) values (
        rec.id, rec.p_id, rec.periodo_inicio, rec.periodo_fim,
        rec.cliente_cnpj, rec.cliente_nome, 'PASS', rec.ativacao_pass,
        v_mes_curva, v_fator_ramp, rec.receita_pass, 0.15, v_comissao, v_status
      ) on conflict do nothing;
      v_count := v_count + 1;
      perform public.inserir_comissao_indicador(
        rec.id, rec.periodo_inicio, rec.periodo_fim, rec.cliente_cnpj, rec.cliente_nome,
        'PASS', rec.ativacao_pass, v_mes_curva, rec.receita_pass, rec.status_cliente
      );
    end if;
    if rec.ativacao_fines is not null and rec.receita_fines is not null then
      v_mes_curva  := public.calcular_mes_curva(rec.ativacao_fines, rec.periodo_fim);
      v_fator_ramp := public.calcular_fator_ramp(v_mes_curva);
      v_comissao   := rec.receita_fines * 0.15 * v_fator_ramp;
      v_status     := case
        when rec.status_cliente = 'churn'        then 'zerada'
        when rec.status_cliente = 'inadimplente' then 'suspensa'
        when v_fator_ramp = 0                    then 'zerada'
        else 'calculada' end;
      insert into public.comissoes (
        fechamento_id, prestador_id, periodo_inicio, periodo_fim,
        cliente_cnpj, cliente_nome, produto, data_ativacao,
        mes_curva, fator_ramp, base_calculo, taxa_comissao, comissao_bruta, status
      ) values (
        rec.id, rec.p_id, rec.periodo_inicio, rec.periodo_fim,
        rec.cliente_cnpj, rec.cliente_nome, 'FINES', rec.ativacao_fines,
        v_mes_curva, v_fator_ramp, rec.receita_fines, 0.15, v_comissao, v_status
      ) on conflict do nothing;
      v_count := v_count + 1;
      perform public.inserir_comissao_indicador(
        rec.id, rec.periodo_inicio, rec.periodo_fim, rec.cliente_cnpj, rec.cliente_nome,
        'FINES', rec.ativacao_fines, v_mes_curva, rec.receita_fines, rec.status_cliente
      );
    end if;
    if rec.ativacao_premium is not null and rec.receita_premium is not null then
      v_mes_curva  := public.calcular_mes_curva(rec.ativacao_premium, rec.periodo_fim);
      v_fator_ramp := public.calcular_fator_ramp(v_mes_curva);
      v_comissao   := rec.receita_premium * 0.15 * v_fator_ramp;
      v_status     := case
        when rec.status_cliente = 'churn'        then 'zerada'
        when rec.status_cliente = 'inadimplente' then 'suspensa'
        when v_fator_ramp = 0                    then 'zerada'
        else 'calculada' end;
      insert into public.comissoes (
        fechamento_id, prestador_id, periodo_inicio, periodo_fim,
        cliente_cnpj, cliente_nome, produto, data_ativacao,
        mes_curva, fator_ramp, base_calculo, taxa_comissao, comissao_bruta, status
      ) values (
        rec.id, rec.p_id, rec.periodo_inicio, rec.periodo_fim,
        rec.cliente_cnpj, rec.cliente_nome, 'PREMIUM', rec.ativacao_premium,
        v_mes_curva, v_fator_ramp, rec.receita_premium, 0.15, v_comissao, v_status
      ) on conflict do nothing;
      v_count := v_count + 1;
      perform public.inserir_comissao_indicador(
        rec.id, rec.periodo_inicio, rec.periodo_fim, rec.cliente_cnpj, rec.cliente_nome,
        'PREMIUM', rec.ativacao_premium, v_mes_curva, rec.receita_premium, rec.status_cliente
      );
    end if;
  end loop;
  update public.uploads set status = 'concluido', linhas_ok = v_count
  where id = p_upload_id;
  return v_count;
end;
$function$;

-- ── 8. Seed: os 3 indicadores existentes (pendentes, sem contrato ativo) ──────
-- Nenhuma comissão é calculada até a gestão preencher os termos reais e
-- mudar o contrato para 'ativo' na tela de Cadastros — inserir_comissao_indicador
-- exige status='ativo'. E-mail placeholder no padrão @efleet.digital, trocar
-- pelo real quando disponível.
insert into public.prestadores (nome, tipo, email, ativo, tipo_parceiro)
values
  ('CLAUDIO', 'PF', 'claudio.indicador@efleet.digital', true, 'indicador'),
  ('LUCIANA', 'PF', 'luciana.indicador@efleet.digital', true, 'indicador'),
  ('ALDO',    'PF', 'aldo.indicador@efleet.digital',    true, 'indicador')
on conflict (email) do nothing;

insert into public.contratos_indicadores (prestador_id, percentual_comissao, periodo_recorrencia, produtos_elegiveis, status)
select id, 0, 12, '{}'::text[], 'pendente' from public.prestadores where email = 'claudio.indicador@efleet.digital'
union all
select id, 0, 12, '{}'::text[], 'pendente' from public.prestadores where email = 'luciana.indicador@efleet.digital'
union all
select id, 0, 12, '{}'::text[], 'pendente' from public.prestadores where email = 'aldo.indicador@efleet.digital';

-- ── 9. Seed: os 38 vínculos cliente→indicador extraídos do histórico do BI ────
-- Um CNPJ (118460530001440) veio com um zero extra grudado no final,
-- repetido de forma consistente na origem — mesmo cliente
-- (DISTRIBUICAO E TRANSPORTES FERNANDO) já cadastrado como 11846053000144.
-- Normalizado aqui para o valor de 14 dígitos que já existe em fechamentos.
with vinculos(cnpj, nome_indicador) as (
  values
    ('01235088000193','ALDO'),
    ('05901381000101','CLAUDIO'),('44689768000270','CLAUDIO'),('05220925000161','CLAUDIO'),
    ('07707626000181','CLAUDIO'),('17330803000107','CLAUDIO'),('09392544000110','CLAUDIO'),
    ('11846053000144','CLAUDIO'), -- corrigido de 118460530001440
    ('07877880000128','CLAUDIO'),('82638206000106','CLAUDIO'),('07621271000103','CLAUDIO'),
    ('12100823000178','CLAUDIO'),('92700306015','CLAUDIO'),('79690152000628','CLAUDIO'),
    ('23504732000114','CLAUDIO'),('36676824000123','CLAUDIO'),('18565020000175','CLAUDIO'),
    ('07973517000106','CLAUDIO'),('15222567000180','CLAUDIO'),('25261375000136','CLAUDIO'),
    ('18748235000121','CLAUDIO'),('11763008000126','CLAUDIO'),('04252967686','CLAUDIO'),
    ('04884878000198','CLAUDIO'),('33136347000115','CLAUDIO'),('18339696000140','CLAUDIO'),
    ('02343801000185','CLAUDIO'),('37176670000173','CLAUDIO'),('19535220000148','CLAUDIO'),
    ('17333680000168','CLAUDIO'),('30440464000180','CLAUDIO'),('81569840000171','CLAUDIO'),
    ('16941799000150','CLAUDIO'),
    ('77124196000150','LUCIANA'),('10463827000195','LUCIANA'),('13975785000160','LUCIANA'),
    ('31877987000150','LUCIANA'),('04916214000163','LUCIANA')
)
insert into public.clientes_indicadores (cliente_cnpj, indicador_id)
select v.cnpj, p.id
from vinculos v
join public.prestadores p on p.nome = v.nome_indicador and p.tipo_parceiro = 'indicador'
on conflict (cliente_cnpj) do nothing;
