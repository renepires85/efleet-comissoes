-- Prévia de comissões do mês corrente.
--
-- Diariamente uma Edge Function busca no Metabase (Data Lake / Athena) a
-- receita acumulada do mês e entrega aqui como jsonb. TODO o cálculo fica
-- neste arquivo, reusando calcular_mes_curva / calcular_fator_ramp /
-- match_prestador_por_nome — a mesma regra do fechamento oficial, sem
-- reimplementar Curva C em TypeScript (já tivemos 3 cópias dessa lógica
-- divergindo entre si; não vamos criar uma quarta).
--
-- É PRÉVIA, não fechamento: o valor muda se o cliente for bloqueado,
-- cancelado ou ficar inadimplente até o fim do mês. Por isso cada linha
-- carrega `bloqueada`, e a tela mostra os três números que a gestão pediu:
--   total calculado · valor bloqueado · valor validado (= total - bloqueado)

create table if not exists public.previa_comissoes (
  id                uuid primary key default gen_random_uuid(),
  prestador_id      uuid not null references public.prestadores(id) on delete cascade,
  periodo_inicio    date not null,
  periodo_fim       date not null,
  cliente_cnpj      text not null,
  cliente_nome      text not null,
  produto           text not null,
  data_ativacao     date,
  mes_curva         integer,
  fator_ramp        numeric,
  base_calculo      numeric not null default 0,
  taxa_comissao     numeric not null default 0,
  comissao_prevista numeric not null default 0,
  status_cliente    text,
  bloqueada         boolean not null default false,
  atualizado_em     timestamptz not null default now()
);

create index if not exists idx_previa_prestador on public.previa_comissoes (prestador_id, periodo_fim);

alter table public.previa_comissoes enable row level security;

drop policy if exists "previa: gestao ve tudo" on public.previa_comissoes;
create policy "previa: gestao ve tudo" on public.previa_comissoes
  for select using (public.meu_perfil() = 'gestao');

drop policy if exists "previa: parceiro ve a propria" on public.previa_comissoes;
create policy "previa: parceiro ve a propria" on public.previa_comissoes
  for select using (prestador_id = public.meu_prestador_id());

grant select, references, trigger, truncate on public.previa_comissoes to authenticated;
grant select, references, trigger, truncate on public.previa_comissoes to anon;

-- ── Cálculo ────────────────────────────────────────────────────────────────────
-- Recebe o resultado da consulta do Metabase como jsonb e substitui a prévia
-- do período. SECURITY DEFINER porque roda pela Edge Function (service_role).
create or replace function public.atualizar_previa_comissoes(p_dados jsonb)
returns integer
language plpgsql
security definer
as $function$
declare
  rec           record;
  v_prestador   uuid;
  v_ini         date;
  v_fim         date;
  v_mes         int;
  v_fator       numeric;
  v_bloqueada   boolean;
  v_count       int := 0;
  v_indicador   uuid;
  v_contrato    record;
begin
  v_ini := date_trunc('month', current_date)::date;
  v_fim := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;

  delete from public.previa_comissoes where periodo_inicio = v_ini;

  for rec in
    select *
    from jsonb_to_recordset(p_dados) as x(
      vendedor_nome   text,
      cliente_cnpj    text,
      cliente_nome    text,
      ativacao_fuel   text,
      receita_fuel    numeric,
      receita_pass    numeric,
      receita_fines   numeric,
      receita_premium numeric,
      status_cliente  text
    )
  loop
    -- Só 'Ativo' entra no valor validado; qualquer outro status (Inadimplente,
    -- Churn, ou valor cru como 'BLOQUEIO AUTOMATICO SISTEMA') vira bloqueada.
    v_bloqueada := coalesce(rec.status_cliente, '') <> 'Ativo';

    -- ── Vendedor ──────────────────────────────────────────────────────────────
    v_prestador := public.match_prestador_por_nome(rec.vendedor_nome);

    -- Prestador inativo não gera prévia (mesma regra de Alertas/Validações/Total).
    if v_prestador is not null
       and exists (select 1 from public.prestadores where id = v_prestador and ativo = true)
    then
      -- FUEL (20%) e mensalidades (15%), mesmas taxas do fechamento oficial.
      if rec.receita_fuel is not null and rec.ativacao_fuel is not null then
        v_mes   := public.calcular_mes_curva(rec.ativacao_fuel::date, v_fim);
        v_fator := public.calcular_fator_ramp(v_mes);
        insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, data_ativacao, mes_curva, fator_ramp, base_calculo, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
        values (v_prestador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'FUEL', rec.ativacao_fuel::date, v_mes, v_fator, rec.receita_fuel, 0.20, rec.receita_fuel * 0.20 * v_fator, rec.status_cliente, v_bloqueada);
        v_count := v_count + 1;
      end if;

      if rec.receita_pass is not null then
        insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, base_calculo, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
        values (v_prestador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'PASS', rec.receita_pass, 0.15, rec.receita_pass * 0.15, rec.status_cliente, v_bloqueada);
        v_count := v_count + 1;
      end if;

      if rec.receita_fines is not null then
        insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, base_calculo, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
        values (v_prestador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'FINES', rec.receita_fines, 0.15, rec.receita_fines * 0.15, rec.status_cliente, v_bloqueada);
        v_count := v_count + 1;
      end if;

      if rec.receita_premium is not null then
        insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, base_calculo, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
        values (v_prestador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'PREMIUM', rec.receita_premium, 0.15, rec.receita_premium * 0.15, rec.status_cliente, v_bloqueada);
        v_count := v_count + 1;
      end if;
    end if;

    -- ── Indicador ─────────────────────────────────────────────────────────────
    -- Mesmas regras do fechamento: contrato ativo, produto elegível, dentro do
    -- período de recorrência, percentual cheio (sem rampa).
    select ci.indicador_id into v_indicador
    from public.clientes_indicadores ci
    where ci.cliente_cnpj = rec.cliente_cnpj;

    if v_indicador is not null
       and exists (select 1 from public.prestadores where id = v_indicador and ativo = true)
    then
      select * into v_contrato
      from public.contratos_indicadores
      where prestador_id = v_indicador and status = 'ativo'
      order by data_inicio desc limit 1;

      if v_contrato is not null then
        if rec.receita_fuel is not null and rec.ativacao_fuel is not null
           and 'FUEL' = any(v_contrato.produtos_elegiveis)
           and public.calcular_mes_curva(rec.ativacao_fuel::date, v_fim) <= v_contrato.periodo_recorrencia
        then
          insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, data_ativacao, mes_curva, fator_ramp, base_calculo, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
          values (v_indicador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'FUEL', rec.ativacao_fuel::date, public.calcular_mes_curva(rec.ativacao_fuel::date, v_fim), 1.0, rec.receita_fuel, v_contrato.percentual_comissao / 100.0, rec.receita_fuel * v_contrato.percentual_comissao / 100.0, rec.status_cliente, v_bloqueada);
          v_count := v_count + 1;
        end if;
      end if;
    end if;
  end loop;

  return v_count;
end;
$function$;
