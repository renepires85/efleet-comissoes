-- A prévia passa a guardar SÓ o mês corrente.
--
-- Ver o comentário dentro da função: a limpeza apagava apenas o período que ia
-- ser regravado, então o mês anterior sobrevivia à virada e era somado junto na
-- tela de Prévias.

CREATE OR REPLACE FUNCTION public.atualizar_previa_comissoes(p_dados jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  -- Apaga o que NÃO é o mês corrente, não só o que vai ser regravado.
  --
  -- Antes: `where periodo_inicio = v_ini`. Setembro apagava setembro e inseria
  -- setembro; agosto ficava para sempre. Na virada de 31/08 para 01/09 — a
  -- primeira que o sistema viveu — a tabela passou a ter os dois meses, e a
  -- tela de Prévias somou R$ 646,89 de agosto com R$ 12,01 de setembro e
  -- apresentou o resultado como "prévia do mês".
  --
  -- Prévia de mês fechado vira comissão em `comissoes`; prévia de mês futuro
  -- não existe. A tabela inteira é substituída a cada carga.
  --
  -- Sem cláusula: `= v_ini` deixava o mês anterior para trás, e `<> v_ini`
  -- (minha primeira tentativa de correção) resolvia isso e criava outro
  -- problema — parava de limpar o mês corrente antes de reinserir, então
  -- rodar duas vezes no mesmo dia duplicava tudo. Apagar tudo é o que
  -- corresponde ao que esta tabela é: uma foto do mês corrente, refeita
  -- do zero a cada carga.
  --
  -- O `where` existe porque o banco recusa DELETE sem cláusula (trava de
  -- segurança do Supabase). `periodo_inicio` é NOT NULL, então a condição
  -- alcança todas as linhas — é um "tudo" explícito, não um filtro.
  delete from public.previa_comissoes where periodo_inicio is not null;

  for rec in
    select *
    from jsonb_to_recordset(p_dados) as x(
      vendedor_nome    text,
      indicador_nome   text,
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
    -- Duas origens para o indicador, nesta ordem:
    --   1. vínculo manual em clientes_indicadores — decisão explícita de alguém
    --      da gestão, e por isso vence;
    --   2. a coluna `indicador` do Data Lake, casada por nome com o mesmo
    --      match_prestador_por_nome usado no vendedor (que ignora acento).
    -- Antes só existia a via manual, o que obrigava a cadastrar cliente a
    -- cliente. Com a segunda, o vínculo passa a vir sozinho do sistema de
    -- origem — mas só para nomes que estejam preenchidos lá.
    v_indicador := null;

    select ci.indicador_id into v_indicador
    from public.clientes_indicadores ci
    where ci.cliente_cnpj = rec.cliente_cnpj;

    if v_indicador is null and coalesce(trim(rec.indicador_nome), '') <> '' then
      v_indicador := public.match_prestador_por_nome(rec.indicador_nome);
    end if;

    if v_indicador is not null
       and exists (select 1 from public.prestadores where id = v_indicador and ativo = true)
    then
      select * into v_contrato
      from public.contratos_indicadores
      where prestador_id = v_indicador and status = 'ativo'
      order by data_inicio desc limit 1;

      -- `if v_contrato is not null` era um BUG: numa variável do tipo registro,
      -- IS NOT NULL só é verdadeiro quando TODAS as colunas são não-nulas.
      -- Bastava uma coluna opcional vazia para o indicador nunca receber
      -- comissão — em silêncio, sem erro. `found` é o que queríamos.
      if found then
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
$function$

