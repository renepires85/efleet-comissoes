-- Lista os acessos de gestão para a tela de Cadastros.
--
-- Não dá para montar isso do navegador: o e-mail e a data do último acesso
-- moram em `auth.users`, que o cliente não alcança. E a `emails_gestao()`, que
-- já existia, não serve aqui — ela devolve só nome e e-mail e filtra
-- `ativo = true`, justamente escondendo quem a tela precisa mostrar para poder
-- reativar.
--
-- SECURITY DEFINER para ler auth.users, com a checagem de perfil DENTRO da
-- função: sem ela, qualquer parceiro autenticado listaria os e-mails de toda a
-- gestão da empresa.

create or replace function public.acessos_gestao()
returns table (
  id               uuid,
  nome             text,
  email            text,
  ativo            boolean,
  senha_provisoria boolean,
  ultimo_acesso    timestamptz,
  criado_em        timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.meu_perfil() <> 'gestao' then
    raise exception 'Apenas a gestão pode listar os acessos de gestão.';
  end if;

  return query
  select u.id, u.nome, au.email::text, u.ativo,
         coalesce(u.senha_provisoria, false), au.last_sign_in_at, u.criado_em
  from public.usuarios u
  join auth.users au on au.id = u.id
  where u.perfil = 'gestao'
  order by u.nome;
end;
$function$;

revoke all on function public.acessos_gestao() from public, anon;
grant execute on function public.acessos_gestao() to authenticated;

comment on function public.acessos_gestao() is
  'Acessos de perfil gestão, com e-mail e último acesso vindos do auth.users. Só gestão pode chamar.';
