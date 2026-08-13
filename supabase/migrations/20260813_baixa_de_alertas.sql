-- Sistema de "baixa" de alertas: a gestão pode encerrar um alerta
-- específico mesmo com o ponto em aberto na origem (ex: sabe do atraso,
-- já tratou por fora, não quer continuar vendo aquele aviso) — mas só
-- com justificativa obrigatória, e a baixa fica registrada (quem, quando,
-- por quê). Não apaga nem resolve o problema real: só silencia aquele
-- alerta específico até a situação mudar de verdade.
--
-- Alertas não são uma entidade própria hoje — são recalculados a cada
-- carregamento do dashboard, a partir de validacoes_mensais.status e da
-- data atual. A chave natural de "qual alerta" é (validacao_id, tipo):
-- uma mesma validação pode gerar tipos diferentes de alerta ao longo do
-- tempo (pendente→prazo vencendo, aprovado→pagamento atrasado), e cada
-- um pode ser baixado de forma independente.

create table if not exists public.alertas_baixados (
  id            uuid primary key default gen_random_uuid(),
  validacao_id  uuid not null references public.validacoes_mensais(id) on delete cascade,
  tipo          text not null check (tipo in ('contestada','pagamento_atrasado','prazo_vencendo','aprovada_aguardando_pagamento')),
  justificativa text not null check (trim(justificativa) <> ''),
  baixado_por   uuid references auth.users(id),
  baixado_em    timestamptz not null default now(),
  unique (validacao_id, tipo)
);

alter table public.alertas_baixados enable row level security;

drop policy if exists "alertas_baixados: gestao tudo" on public.alertas_baixados;
create policy "alertas_baixados: gestao tudo" on public.alertas_baixados
  for all using (public.meu_perfil() = 'gestao') with check (public.meu_perfil() = 'gestao');

grant select, insert, delete, references, trigger, truncate on public.alertas_baixados to authenticated;
grant select, references, trigger, truncate on public.alertas_baixados to anon;
