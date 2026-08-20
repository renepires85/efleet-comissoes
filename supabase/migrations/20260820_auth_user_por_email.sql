-- Descobre o id do usuário de Auth a partir do e-mail.
--
-- Existe por causa de um caso real: o José Lucas tinha usuário criado no Auth,
-- mas o `prestadores.usuario_id` estava vazio — o cadastro e o login existiam
-- sem se conhecerem. Ao tentar recriar o acesso, o Auth respondia
-- `email_exists` e não devolvia o id, então não havia como religar os dois: o
-- convite falhava para sempre, sem saída pela tela.
--
-- A API Admin não tem busca por e-mail (só listUsers paginado, que quebra
-- quando a base crescer). Daqui sai o id exato em uma consulta.
--
-- SECURITY DEFINER porque `auth.users` não é acessível ao papel da requisição.
-- Só a Edge Function (service_role) chama isto; revogamos de anon/authenticated
-- para que a existência de um e-mail na base não seja consultável de fora.

create or replace function public.auth_user_id_por_email(p_email text)
returns uuid
language sql
security definer
set search_path = auth, public
as $function$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$function$;

revoke all on function public.auth_user_id_por_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_por_email(text) to service_role;

comment on function public.auth_user_id_por_email(text) is
  'Id do usuário de Auth pelo e-mail. Uso interno da smart-service para religar um prestador a um login que já existe.';
