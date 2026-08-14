-- Guarda o que falta para a ficha do cliente na prévia.
--
-- A tela vai abrir uma janelinha ao clicar no nome do cliente, com TPV, data da
-- primeira transação/mensalidade e o percentual aplicado. Dois desses dados a
-- prévia não tinha:
--
--   tpv — a prévia só guardava `base_calculo` (a receita da eFleet). O TPV é o
--   volume transacionado pelo cliente, número que o parceiro reconhece como "o
--   tamanho do cliente" e que não dá para derivar da receita.
--
--   data_ativacao nas mensalidades — só as linhas de FUEL tinham data. Para
--   PASS/FINES/PREMIUM ficava nula, então não havia como mostrar "1ª
--   mensalidade". Vem do MIN(receita_date) por fonte, a mesma derivação que o
--   fechamento mensal já usa.

alter table public.previa_comissoes
  add column if not exists tpv numeric;

comment on column public.previa_comissoes.tpv is
  'Volume transacionado pelo cliente no mês (FUEL). Distinto de base_calculo, que é a receita da eFleet.';

create or replace function public.atualizar_previa_comissoes(p_dados jsonb)
returns integer
language plpgsql
security definer
as $function$
declare
  rec         record;
  v_prestador uuid;
  v_ini       date;
  v_fim       date;
  v_mes       int;
  v_fator     numeric;
  v_bloqueada boolean;
  v_count     int := 0;
  v_indicador uuid;
  v_contrato  record;
begin
  v_ini := date_trunc('month', current_date)::date;
  v_fim := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;

  delete from public.previa_comissoes where periodo_inicio = v_ini;

  for rec in
    select *
    from jsonb_to_recordset(p_dados) as x(
      vendedor_nome    text,
      cliente_cnpj     text,
      cliente_nome     text,
      ativacao_fuel    text,
      ativacao_pass    text,
      ativacao_fines   text,
      ativacao_premium text,
      tpv_fuel         numeric,
      receita_fuel     numeric,
      receita_pass     numeric,
      receita_fines    numeric,
      receita_premium  numeric,
      status_cliente   text
    )
  loop
    v_bloqueada := coalesce(rec.status_cliente, '') <> 'Ativo';

    v_prestador := public.match_prestador_por_nome(rec.vendedor_nome);

    if v_prestador is not null
       and exists (select 1 from public.prestadores where id = v_prestador and ativo = true)
    then
      if rec.receita_fuel is not null and rec.ativacao_fuel is not null then
        v_mes   := public.calcular_mes_curva(rec.ativacao_fuel::date, v_fim);
        v_fator := public.calcular_fator_ramp(v_mes);
        insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, data_ativacao, mes_curva, fator_ramp, base_calculo, tpv, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
        values (v_prestador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'FUEL', rec.ativacao_fuel::date, v_mes, v_fator, rec.receita_fuel, rec.tpv_fuel, 0.20, rec.receita_fuel * 0.20 * v_fator, rec.status_cliente, v_bloqueada);
        v_count := v_count + 1;
      end if;

      if rec.receita_pass is not null then
        insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, data_ativacao, base_calculo, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
        values (v_prestador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'PASS', nullif(rec.ativacao_pass,'')::date, rec.receita_pass, 0.15, rec.receita_pass * 0.15, rec.status_cliente, v_bloqueada);
        v_count := v_count + 1;
      end if;

      if rec.receita_fines is not null then
        insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, data_ativacao, base_calculo, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
        values (v_prestador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'FINES', nullif(rec.ativacao_fines,'')::date, rec.receita_fines, 0.15, rec.receita_fines * 0.15, rec.status_cliente, v_bloqueada);
        v_count := v_count + 1;
      end if;

      if rec.receita_premium is not null then
        insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, data_ativacao, base_calculo, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
        values (v_prestador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'PREMIUM', nullif(rec.ativacao_premium,'')::date, rec.receita_premium, 0.15, rec.receita_premium * 0.15, rec.status_cliente, v_bloqueada);
        v_count := v_count + 1;
      end if;
    end if;

    -- ── Indicador ─────────────────────────────────────────────────────────────
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
          insert into public.previa_comissoes (prestador_id, periodo_inicio, periodo_fim, cliente_cnpj, cliente_nome, produto, data_ativacao, mes_curva, fator_ramp, base_calculo, tpv, taxa_comissao, comissao_prevista, status_cliente, bloqueada)
          values (v_indicador, v_ini, v_fim, rec.cliente_cnpj, rec.cliente_nome, 'FUEL', rec.ativacao_fuel::date, public.calcular_mes_curva(rec.ativacao_fuel::date, v_fim), 1.0, rec.receita_fuel, rec.tpv_fuel, v_contrato.percentual_comissao / 100.0, rec.receita_fuel * v_contrato.percentual_comissao / 100.0, rec.status_cliente, v_bloqueada);
          v_count := v_count + 1;
        end if;
      end if;
    end if;
  end loop;

  return v_count;
end;
$function$;
