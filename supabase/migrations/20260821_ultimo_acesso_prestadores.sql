-- Último acesso de cada parceiro, para a aba Cadastros.
--
-- `auth.users.last_sign_in_at` não é alcançável pelo cliente, e é a única fonte
-- dessa informação — `prestadores` e `usuarios` não guardam nada sobre sessão.
-- Sem isto, a gestão não tem como saber quem nunca entrou: hoje há parceiro com
-- comissão parada há meses que talvez nunca tenha aberto o sistema, e a única
-- forma de descobrir era consultar o banco por fora.
--
-- Devolve uma linha por PRESTADOR (não por usuário), para a tela poder casar
-- direto pelo id que já tem em mãos.

create or replace function public.ultimo_acesso_prestadores()
returns table (
  prestador_id  uuid,
  email         text,
  ultimo_acesso timestamptz,
  criado_em     timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.meu_perfil() <> 'gestao' then
    raise exception 'Apenas a gestão pode consultar os acessos.';
  end if;

  return query
  select p.id, au.email::text, au.last_sign_in_at, au.created_at
  from public.prestadores p
  join auth.users au on au.id = p.usuario_id;
end;
$function$;

revoke all on function public.ultimo_acesso_prestadores() from public, anon;
grant execute on function public.ultimo_acesso_prestadores() to authenticated;

comment on function public.ultimo_acesso_prestadores() is
  'Último login de cada prestador, lido de auth.users. Só gestão pode chamar.';
