-- Gestão passa a enxergar e administrar os acessos de gestão.
--
-- Até aqui a aba Cadastros lia só `prestadores`, que guarda parceiro comercial.
-- Usuário de gestão existe apenas em `usuarios` e não aparecia em tela nenhuma:
-- dava para CRIAR um pelo botão Convidar e nunca mais vê-lo. Ou seja, o perfil
-- de maior privilégio do sistema — vê a comissão de todos os parceiros, roda o
-- cálculo, aprova pagamento — era o único sem lista, sem auditoria e sem forma
-- de revogar.

-- A policy de leitura acompanha o padrão já usado em `prestadores`.
-- meu_perfil() é SECURITY DEFINER e lê `usuarios` por fora do RLS, então não há
-- recursão ao usá-la numa policy da própria tabela.
drop policy if exists "usuarios: gestao ve todos" on public.usuarios;
create policy "usuarios: gestao ve todos"
  on public.usuarios for select
  using (public.meu_perfil() = 'gestao');

-- Ativar/inativar por função, e não por uma policy de UPDATE: uma policy ampla
-- daria à gestão escrita na linha inteira, incluindo `perfil`. Aqui só o campo
-- `ativo` se move, e a função recusa dois casos que uma policy não saberia
-- recusar.
create or replace function public.definir_status_usuario(
  p_usuario_id uuid,
  p_ativo      boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.meu_perfil() <> 'gestao' then
    raise exception 'Apenas a gestão pode ativar ou inativar acessos.';
  end if;

  -- Sem isso, a última pessoa de gestão consegue se trancar para fora do
  -- sistema com um clique — e não sobra ninguém com permissão para desfazer.
  if p_usuario_id = auth.uid() and p_ativo = false then
    raise exception 'Você não pode inativar o seu próprio acesso.';
  end if;

  update public.usuarios
  set ativo = p_ativo, atualizado_em = now()
  where id = p_usuario_id;
end;
$function$;

revoke all on function public.definir_status_usuario(uuid, boolean) from public, anon;
grant execute on function public.definir_status_usuario(uuid, boolean) to authenticated;

comment on function public.definir_status_usuario(uuid, boolean) is
  'Liga/desliga o acesso de um usuário. Só gestão; ninguém inativa a si mesmo. Único caminho de escrita em usuarios.ativo liberado ao cliente.';
