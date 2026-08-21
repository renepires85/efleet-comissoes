-- O parceiro passa a poder mudar SÓ o desfecho da própria validação.
--
-- A policy `validacoes: parceiro aprova as proprias` limita quem (a própria
-- linha), quando (só enquanto pendente) e o destino do `status` — mas o
-- WITH CHECK fala apenas de `status`. Todas as outras colunas ficavam livres na
-- mesma requisição. Verificado com sessão real de parceiro:
--
--   • mudou `periodo_inicio`/`periodo_fim` de julho para o ano inteiro,
--     junto com a aprovação;
--   • gravou `pago_em`, marcando a própria comissão como paga.
--
-- O segundo é o mais grave: uma validação com `pago_em` preenchido sai da lista
-- de "aprovadas aguardando pagamento" do relatório da gestão. O parceiro
-- conseguiria esconder a própria dívida — e, do outro lado, o registro passaria
-- a afirmar um pagamento que nunca houve.
--
-- O isolamento entre parceiros estava correto: a tentativa de aprovar a
-- validação de outro não altera nenhuma linha.
--
-- Mesma escolha da trava de `prestadores`: gatilho, e não GRANT por coluna, que
-- atingiria a gestão junto — ela também é `authenticated`.

create or replace function public.validacao_protege_campos()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null or public.meu_perfil() = 'gestao' then
    return new;
  end if;

  -- O parceiro decide o desfecho e escreve a justificativa. Nada mais.
  new.prestador_id   := old.prestador_id;
  new.periodo_inicio := old.periodo_inicio;
  new.periodo_fim    := old.periodo_fim;
  new.upload_id      := old.upload_id;
  new.criado_em      := old.criado_em;
  new.notificado_em  := old.notificado_em;
  new.pago_em        := old.pago_em;
  new.pago_por       := old.pago_por;

  -- A data da aprovação é carimbada aqui, não aceita do cliente: é registro do
  -- sistema sobre quando o aceite aconteceu, não uma informação que o
  -- interessado preenche.
  if new.status = 'aprovado' and old.status <> 'aprovado' then
    new.aprovado_em := now();
  else
    new.aprovado_em := old.aprovado_em;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validacao_protege_campos on public.validacoes_mensais;
create trigger trg_validacao_protege_campos
  before update on public.validacoes_mensais
  for each row execute function public.validacao_protege_campos();

comment on function public.validacao_protege_campos() is
  'Restringe o parceiro a alterar status e observação da própria validação. O WITH CHECK da policy só cobria o status, deixando período e pago_em livres.';
