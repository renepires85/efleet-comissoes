-- Corrige a inconsistência: fechamentos.prestador_id era preenchido no
-- navegador com match EXATO (uploads.js), enquanto comissoes.prestador_id
-- usa o fuzzy match de 3 níveis do banco (processar_comissoes). Resultado:
-- só 12 das 157 linhas de fechamentos tinham prestador_id preenchido — e
-- foi essa lacuna que escondeu, até 2026-08-12, que o indicador nunca
-- recebia validação (criar_validacoes_pendentes lia essa coluna).
--
-- Em vez de só corrigir o valor, elimina a causa: extrai o match para uma
-- função única (match_prestador_por_nome), usada tanto por
-- processar_comissoes quanto pelo backfill abaixo. fechamentos e comissoes
-- passam a vir sempre da mesma fonte — não há mais dois lugares para
-- ficarem dessincronizados.

-- ── 1. Função única de match ───────────────────────────────────────────────────
create or replace function public.match_prestador_por_nome(p_nome text)
returns uuid
language sql
stable
as $function$
  select p.id
  from (
    select p1.id, 1 as prio
    from public.prestadores p1
    where lower(trim(p1.nome)) = lower(trim(p_nome))
    union all
    select p2.id, 2
    from (
      select px.id, count(*) over () as qtd
      from public.prestadores px
      where lower(px.nome) like '%' || lower(trim(p_nome)) || '%'
    ) p2
    where p2.qtd = 1
    union all
    select p3.id, 3
    from (
      select px.id, count(*) over () as qtd
      from public.prestadores px
      where (select bool_and(lower(px.nome) like '%' || w || '%')
             from unnest(string_to_array(lower(trim(p_nome)), ' ')) as w)
    ) p3
    where p3.qtd = 1
  ) p
  order by p.prio
  limit 1
$function$;

-- ── 2. processar_comissoes: preenche fechamentos.prestador_id primeiro ────────
-- Um UPDATE em massa antes do loop, usando a função acima — computa o match
-- uma única vez por linha. O loop passa a ler f.prestador_id já correto, em
-- vez de recalcular com join lateral. Resto da função idêntico ao de
-- 2026-07-15 (Curva C, taxas, status) e 2026-08-12 (chamada ao indicador).
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
  update public.fechamentos
  set    prestador_id = public.match_prestador_por_nome(vendedor_nome)
  where  upload_id = p_upload_id
  and    trim(coalesce(vendedor_nome, '')) <> '';

  -- comissoes.prestador_id é NOT NULL: preserva o comportamento anterior de
  -- pular em silêncio fechamentos sem match (vendedor sem cadastro em
  -- prestadores), em vez de quebrar a função inteira numa violação de
  -- constraint. O JOIN LATERAL ... ON true da versão anterior fazia esse
  -- descarte implicitamente; aqui fica explícito.
  for rec in
    select f.*, f.prestador_id as p_id
    from   public.fechamentos f
    where  f.upload_id = p_upload_id
      and  trim(coalesce(f.vendedor_nome, '')) <> ''
      and  f.prestador_id is not null
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

-- ── 3. Backfill: corrige as 157 linhas já existentes ───────────────────────────
update public.fechamentos
set    prestador_id = public.match_prestador_por_nome(vendedor_nome)
where  trim(coalesce(vendedor_nome, '')) <> '';
