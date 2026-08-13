-- Higienização de contas de teste, a pedido do usuário.
--
-- Excluídos (login + cadastro de prestador, quando existir):
--   Ana Costa, Carlos Lima, João Silva, Maria Souza — vendedores de teste,
--     e-mails pessoais do próprio usuário (teste@efleet.digital,
--     reneaugustoja@icloud.com, reneaugustoja@gmail.com,
--     documentosefleet@gmail.com), prestador já inativo.
--   Leandro Brito Oliveira, vendedor (leandrobrito038@gmail.com) — mesmo
--     padrão dos quatro acima.
--   Leandro Brito Oliveira, gestão (leandro.oliveira@efleet.digital) — sem
--     prestador vinculado; usuário confirmou explicitamente que também é
--     conta de teste, apesar do e-mail corporativo.
--
-- validacoes_mensais_prestador_id_fkey é ON DELETE CASCADE — as 3 validações
-- vinculadas a essas contas de teste (Carlos Lima, João Silva, Maria Souza)
-- somem junto, sem precisar de DELETE explícito.
--
-- Ordem: prestadores (FK usuario_id → usuarios é ON DELETE SET NULL, não
-- apaga sozinho) → usuarios → auth.users (cascata nativa do Supabase cuida
-- de identities/sessions/refresh_tokens).
--
-- Eduardo Figueiredo não foi excluído — é uma pessoa só, com um único
-- usuario_id ligando login e cadastro de vendedor. "É só vendedor" aqui
-- significa mudar o perfil, não apagar nada; ele também sai da lista de
-- destinatários do relatório semanal de gestão (emails_gestao()), que já
-- filtra por perfil='gestao'.
--
-- Alice Morais não teve nenhuma mudança — já não tinha cadastro de
-- prestador, "só gestão" já era o estado real.

delete from public.prestadores where id in (
  'a0efe3dd-b834-4af6-b3f6-7e3659750735', -- Ana Costa
  '2c75d5db-5bb4-415e-afff-63c7ccf2f457', -- Carlos Lima
  'c4c448cf-df44-4d92-a9d2-4c8be7970288', -- João Silva
  '7dbc7e00-8627-4751-a3db-94315813cce8', -- Maria Souza
  '5b307592-4916-4c35-9d7a-02556f0794d1'  -- Leandro Brito Oliveira (vendedor)
);

delete from public.usuarios where id in (
  'c23b1fa9-c4e5-42c6-bbec-1f8632cd9c94', -- Ana Costa
  '292c8fa3-209d-4dd6-bce6-94319229b0e2', -- Carlos Lima
  'f0c88a84-7af5-4801-b082-e16be6bc6b80', -- João Silva
  '5e6116c9-3a1e-40be-b1b4-7d8a18d6cb01', -- Maria Souza
  'd4b7657f-5168-4c5f-843b-6f026607407f', -- Leandro Brito Oliveira (vendedor)
  '00d8f11a-0b8c-471c-aa91-aedc6311d96e'  -- Leandro Brito Oliveira (gestão)
);

delete from auth.users where id in (
  'c23b1fa9-c4e5-42c6-bbec-1f8632cd9c94',
  '292c8fa3-209d-4dd6-bce6-94319229b0e2',
  'f0c88a84-7af5-4801-b082-e16be6bc6b80',
  '5e6116c9-3a1e-40be-b1b4-7d8a18d6cb01',
  'd4b7657f-5168-4c5f-843b-6f026607407f',
  '00d8f11a-0b8c-471c-aa91-aedc6311d96e'
);

update public.usuarios set perfil = 'vendedor'
where id = '3fe233ed-d88b-48fa-9ddf-e17ed7862d46'; -- Eduardo Figueiredo
