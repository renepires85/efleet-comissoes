-- Só cria validação pendente quando há efetivamente algo a pagar.
--
-- Antes, a função criava uma validação para QUALQUER par (prestador, período)
-- com linha em `comissoes` — inclusive quando todas as comissões daquele
-- período estavam zeradas (fora da janela da Curva C, ou cliente em churn) ou
-- suspensas (cliente inadimplente). O parceiro recebia um pedido de aprovação
-- de R$ 0,00: nada para conferir, nada para liberar, e o aviso vermelho na
-- tela dele apontando para um valor inexistente.
--
-- Escala com o fechamento automático: 8 das 25 pendências (32%) eram assim, e
-- todo mês nasceriam mais. Um alerta que aparece sem motivo ensina o usuário a
-- ignorar alertas — o problema não é o registro a mais, é o aviso perder o
-- sentido.
--
-- Critério: pelo menos uma comissão 'calculada' com valor > 0. Comissão
-- 'suspensa' não conta — o parceiro não destrava esse dinheiro aprovando, ele
-- depende do cliente regularizar. Ela continua visível no extrato dele, com o
-- status explicando o motivo; só não vira pedido de aprovação.
--
-- De quebra: o retorno contava as iterações do laço, não as inserções reais.
-- Com `on conflict do nothing`, reprocessar um upload relatava validações que
-- não foram criadas. Agora conta o que de fato entrou.

create or replace function public.criar_validacoes_pendentes(p_upload_id uuid)
returns integer
language plpgsql
as $function$
declare
  rec        record;
  v_count    int := 0;
  v_inserido int;
begin
  for rec in
    select   c.prestador_id, c.periodo_inicio, c.periodo_fim
    from     public.comissoes c
    join     public.fechamentos f on f.id = c.fechamento_id
    where    f.upload_id = p_upload_id
      and    c.prestador_id is not null
    group by c.prestador_id, c.periodo_inicio, c.periodo_fim
    having   coalesce(sum(c.comissao_bruta) filter (where c.status = 'calculada'), 0) > 0
  loop
    insert into public.validacoes_mensais (prestador_id, periodo_inicio, periodo_fim)
    values (rec.prestador_id, rec.periodo_inicio, rec.periodo_fim)
    on conflict (prestador_id, periodo_inicio, periodo_fim) do nothing;

    get diagnostics v_inserido = row_count;
    v_count := v_count + v_inserido;
  end loop;

  return v_count;
end;
$function$;
