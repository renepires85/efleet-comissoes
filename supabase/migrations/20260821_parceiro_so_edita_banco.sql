-- O parceiro passa a poder editar SÓ os próprios dados de pagamento.
--
-- A policy `prestadores: vendedor edita banco proprio` deixa o parceiro dar
-- UPDATE na própria linha — mas RLS não restringe COLUNA. Na prática ele podia
-- reescrever o cadastro inteiro. Verificado com sessão real: `nome`,
-- `documento`, `tipo_parceiro` e `ativo` foram todos gravados por um parceiro
-- comum, apesar de a tela desabilitar esses campos (desabilitar no navegador
-- não protege nada — a API aceita a requisição direta).
--
-- O `nome` é o pior deles: é a chave que casa a comissão vinda do Data Lake.
-- Um parceiro que se renomeasse com o nome de outro poderia desviar a comissão
-- alheia para si.
--
-- GRANT por coluna resolveria, mas atingiria a gestão junto — ela também é
-- `authenticated`. Por isso a trava é um gatilho: quem não for gestão tem os
-- campos protegidos restaurados ao valor anterior, silenciosamente, venha a
-- alteração de onde vier — tela, API ou script.

create or replace function public.prestador_protege_campos()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Gestão edita tudo. Também deixamos passar quando não há usuário na sessão:
  -- é o caso das Edge Functions com service_role, que precisam preencher
  -- usuario_id ao criar o acesso.
  if auth.uid() is null or public.meu_perfil() = 'gestao' then
    return new;
  end if;

  -- Identidade e situação do parceiro não são dele para mudar.
  new.nome            := old.nome;
  new.documento       := old.documento;
  new.tipo            := old.tipo;
  new.tipo_parceiro   := old.tipo_parceiro;
  new.ativo           := old.ativo;
  new.email           := old.email;
  new.codigo          := old.codigo;
  new.usuario_id      := old.usuario_id;
  new.criado_em       := old.criado_em;

  -- Sobram os dados de pagamento, que são dele: banco, agencia, conta,
  -- tipo_conta, pix, telefone, cpf_responsavel.
  return new;
end;
$function$;

drop trigger if exists trg_prestador_protege_campos on public.prestadores;
create trigger trg_prestador_protege_campos
  before update on public.prestadores
  for each row execute function public.prestador_protege_campos();

comment on function public.prestador_protege_campos() is
  'Impede que um parceiro altere identidade e situação do próprio cadastro. RLS não restringe coluna e a policy de UPDATE liberava a linha inteira.';
