-- A validação passa a saber de qual upload ela nasceu.
--
-- `criar_validacoes_pendentes` inseria sem preencher `upload_id`, e a exclusão
-- de arquivo (excluirArquivo, em uploads.js) apaga as validações POR upload_id.
-- As duas pontas nunca se encontravam: apagar um fechamento removia comissões e
-- fechamentos e deixava as validações para trás, órfãs — cobrando aprovação de
-- um cálculo que não existe mais, e alimentando o lembrete diário por e-mail.
--
-- Toda validação da base hoje tem upload_id nulo, o que confirma que nenhuma
-- jamais foi limpa por esse caminho.

create or replace function public.criar_validacoes_pendentes(p_upload_id uuid)
returns integer
language plpgsql
as $function$
declare
  rec        record;
  v_count    int := 0;
  v_inserido int;
begin
  for rec in
    select   c.prestador_id, c.periodo_inicio, c.periodo_fim
    from     public.comissoes c
    join     public.fechamentos f on f.id = c.fechamento_id
    where    f.upload_id = p_upload_id
      and    c.prestador_id is not null
    group by c.prestador_id, c.periodo_inicio, c.periodo_fim
    -- Sem valor a pagar não existe o que aprovar: a validação não nasce.
    having   coalesce(sum(c.comissao_bruta) filter (where c.status = 'calculada'), 0) > 0
  loop
    insert into public.validacoes_mensais
      (prestador_id, periodo_inicio, periodo_fim, upload_id)
    values
      (rec.prestador_id, rec.periodo_inicio, rec.periodo_fim, p_upload_id)
    on conflict (prestador_id, periodo_inicio, periodo_fim) do nothing;

    get diagnostics v_inserido = row_count;
    v_count := v_count + v_inserido;
  end loop;

  return v_count;
end;
$function$;

comment on function public.criar_validacoes_pendentes(uuid) is
  'Cria a validação pendente de cada parceiro com valor a pagar no upload. Grava o upload_id para que a exclusão do arquivo consiga limpar o que ele gerou.';
