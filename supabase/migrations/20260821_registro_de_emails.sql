-- Registro de todo e-mail que o sistema envia.
--
-- Existe porque hoje não há como responder "quem recebeu o quê, quando". As
-- funções devolvem uma contagem no momento da execução e nada fica guardado:
-- quando as seis validações de agosto cobraram aprovação por e-mail, não foi
-- possível dizer quem tinha sido avisado. Num sistema que trata dinheiro de
-- terceiros, "mandamos, mas não sabemos para quem" não é resposta.
--
-- Guarda a falha também. Um e-mail que não sai é indistinguível de um que sai
-- quando nada é registrado — e é justamente o que não sai que precisa de ação.

create table if not exists public.emails_enviados (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null,
  destinatario  text not null,
  assunto       text,
  prestador_id  uuid references public.prestadores(id) on delete set null,
  usuario_id    uuid references public.usuarios(id)    on delete set null,
  -- Contexto do envio: períodos cobrados, ids de validação, motivo. Fica em
  -- jsonb porque cada tipo de e-mail tem um contexto diferente e não vale uma
  -- coluna para cada um.
  referencia    jsonb,
  sucesso       boolean not null,
  erro          text,
  provedor_id   text,
  enviado_em    timestamptz not null default now()
);

create index if not exists idx_emails_enviados_data on public.emails_enviados (enviado_em desc);
create index if not exists idx_emails_enviados_tipo on public.emails_enviados (tipo, enviado_em desc);
create index if not exists idx_emails_enviados_dest on public.emails_enviados (lower(destinatario));

comment on table public.emails_enviados is
  'Histórico de e-mails enviados pelo sistema, incluindo falhas. Escrito pelas Edge Functions com service_role; leitura só para gestão.';

alter table public.emails_enviados enable row level security;

-- Só gestão lê. O assunto e a referência contam quem deve quanto a quem — é
-- informação de gestão, não de parceiro, mesmo quando o parceiro é o
-- destinatário.
drop policy if exists "emails: gestao le" on public.emails_enviados;
create policy "emails: gestao le"
  on public.emails_enviados for select
  using (public.meu_perfil() = 'gestao');

-- Ninguém escreve pelo cliente: quem grava é a Edge Function, com service_role,
-- que ignora RLS. Sem policy de insert/update/delete, um registro de envio não
-- pode ser forjado nem apagado a partir do navegador.

-- O RLS só entra em cena depois do GRANT: sem esta linha, `authenticated` não
-- tem SELECT na tabela e a policy acima nunca chega a ser avaliada — a gestão
-- levaria "permission denied" igual a todo mundo. Nenhum grant de escrita, de
-- propósito.
grant select on public.emails_enviados to authenticated;
