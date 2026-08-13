-- Ponta solta #1: o indicador nunca ganhava validação (aprovar/contestar/pagar).
--
-- Causa raiz: criar_validacoes_pendentes lia DISTINCT fechamentos.prestador_id
-- — coluna preenchida por um match EXATO feito no navegador (uploads.js),
-- diferente do fuzzy match em 3 níveis que processar_comissoes usa contra o
-- banco. Resultado: só 12 das 157 linhas de fechamentos tinham prestador_id
-- preenchido, e indicador NUNCA aparece como vendedor_nome — então nunca
-- teria validação criada, mesmo tendo comissão calculada.
--
-- Correção: ler DISTINCT prestador_id de `comissoes` (via fechamento_id),
-- que é preenchida de forma confiável pelo próprio processar_comissoes para
-- vendedor E indicador — mesma fonte que já alimenta o pagamento. Fecha a
-- lacuna do indicador sem nenhum código específico para ele.
create or replace function public.criar_validacoes_pendentes(p_upload_id uuid)
 returns integer
 language plpgsql
as $function$
declare
  rec     record;
  v_count int := 0;
begin
  for rec in
    select distinct c.prestador_id, c.periodo_inicio, c.periodo_fim
    from   public.comissoes c
    join   public.fechamentos f on f.id = c.fechamento_id
    where  f.upload_id = p_upload_id
    and    c.prestador_id is not null
  loop
    insert into public.validacoes_mensais (prestador_id, periodo_inicio, periodo_fim)
    values (rec.prestador_id, rec.periodo_inicio, rec.periodo_fim)
    on conflict (prestador_id, periodo_inicio, periodo_fim) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
