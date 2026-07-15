-- Corrige o vínculo fechamentos → prestadores na processar_comissoes.
-- Antes: join exato e case-sensitive (p.nome = f.vendedor_nome), que falhava
-- quando o CSV do BI vinha em caixa alta ou com nome abreviado.
-- Agora o match resolve em 3 níveis de prioridade:
--   1. exato normalizado: lower(trim()) dos dois lados
--   2. cadastro contém o nome do CSV como substring — só quando o match é único
--   3. todas as palavras do nome do CSV aparecem no nome do cadastro
--      (ex: "LUANA ROCCHI" → "LUANA ROSA ROCCHI") — só quando o match é único
-- Linhas com vendedor_nome vazio são ignoradas (evita LIKE '%%' casar com todos).
-- Demais lógicas (Curva C, taxas, status, update do upload) permanecem intactas.

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
    end if;
  end loop;
  update public.uploads set status = 'concluido', linhas_ok = v_count
  where id = p_upload_id;
  return v_count;
end;
$function$;
