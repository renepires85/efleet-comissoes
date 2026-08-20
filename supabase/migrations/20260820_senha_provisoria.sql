-- Marca quem ainda está com a senha que o sistema gerou.
--
-- O e-mail de acesso manda trocar a senha no primeiro acesso, e o sistema nunca
-- cobrou isso: a tela de troca existia, mas era opcional. Na prática a senha
-- provisória — gerada por nós, trafegada por e-mail — virava a senha definitiva
-- do parceiro, sem prazo para expirar. Apontado no teste do Marlon (Bug 2).
--
-- A flag é ligada pela smart-service toda vez que ela gera uma senha, e
-- desligada quando a pessoa escolhe a dela. Enquanto estiver ligada, o login
-- para na tela de troca e não abre o sistema.

alter table public.usuarios
  add column if not exists senha_provisoria boolean not null default false;

comment on column public.usuarios.senha_provisoria is
  'true enquanto a pessoa estiver usando a senha gerada pelo sistema. Ligada pela smart-service ao enviar acesso; desligada quando o usuário define a própria senha. Bloqueia o login na tela de troca.';

-- Quem já tem uma senha nossa e nunca escolheu a própria. Só os casos em que
-- isso é verificável: os três acessos criados hoje pela smart-service e as
-- contas que nunca chegaram a entrar. Os demais logins antigos ficam de fora
-- porque não há como saber, pelos dados, se a pessoa já trocou — e forçar troca
-- em cima de quem escolheu a própria senha seria ruído sem ganho.
update public.usuarios u
set senha_provisoria = true
from auth.users au
where au.id = u.id
  and (
    au.last_sign_in_at is null
    or lower(au.email) in (
      'jose.pinto@grupoaldo.com.br',
      'sabrinaxprado@hotmail.com',
      'reneaugustoja@icloud.com'
    )
  );
