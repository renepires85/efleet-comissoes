-- Desliga a flag de senha provisória do próprio usuário.
--
-- Precisa existir porque `usuarios` tem RLS ligado e só uma policy de SELECT:
-- um update vindo do navegador não falha, ele afeta ZERO linhas em silêncio. A
-- pessoa trocaria a senha, continuaria marcada, e no login seguinte cairia de
-- novo na tela de troca — para sempre.
--
-- A saída óbvia seria uma policy de UPDATE em `usuarios`, e ela seria pior:
-- daria ao usuário permissão de escrever a própria linha inteira, incluindo
-- `perfil`. Qualquer parceiro viraria gestão. Esta função troca esse poder por
-- um único campo, sem parâmetro nenhum: quem chama só consegue afetar a própria
-- linha, porque o id vem de auth.uid() e não de argumento.

create or replace function public.concluir_troca_de_senha()
returns void
language sql
security definer
set search_path = public
as $function$
  update public.usuarios
  set senha_provisoria = false, atualizado_em = now()
  where id = auth.uid();
$function$;

revoke all on function public.concluir_troca_de_senha() from public, anon;
grant execute on function public.concluir_troca_de_senha() to authenticated;

comment on function public.concluir_troca_de_senha() is
  'Marca que o usuário logado já definiu a própria senha. Único caminho de escrita em usuarios liberado ao cliente — deliberadamente restrito a um campo.';
