// Fechamento mensal automático: busca no Metabase a receita consolidada do mês
// anterior e entrega ao Postgres, que grava e calcula em
// executar_fechamento_mensal(). Nenhuma regra de comissão vive aqui.
//
// Agendada para o dia 02 às 03h (BRT), com retentativa nos dias 3 a 5 — ver
// 20260901_fechamento_dia_02.sql.
//
// A data não é arbitrária: o Data Lake só carrega os dados de um dia DEPOIS que
// ele acaba (às 13h de um dia útil, o próprio dia tinha 3% do volume típico).
// Fechar no dia 01 pegaria o último dia do mês vazio e pagaria a menos a todos
// os parceiros, sem nenhum sinal de erro. Medição de 01/09/2026: o dia 31/08
// já estava com 118% da média diária, ou seja completo, enquanto o dia corrente
// aparecia com 6% — daí a folga para antecipar do dia 3 para o dia 2.
//
// TRAVA DE COMPLETUDE: como o resultado vai direto aos parceiros, sem revisão
// humana, a função se recusa a fechar se o último dia do mês tiver volume muito
// abaixo da média do próprio mês — sinal de que o ETL ainda não terminou.
// Nesse caso responde `adiado` e não grava nada; o cron tenta de novo no dia
// seguinte. Preferimos atrasar o fechamento a fechar errado.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const METABASE_URL = Deno.env.get("METABASE_URL") ?? "https://dados.efleet.com.br";
const DATABASE_ID = 2;

// Abaixo de 40% da média diária do mês, tratamos o último dia como incompleto.
// Um dia fraco de verdade (fim de semana) costuma ficar em ~50%; abaixo disso
// a explicação provável é ETL pela metade, não queda de operação.
const LIMITE_COMPLETUDE = 0.4;

// Avisa a gestão do resultado — inclusive quando a resposta é "adiei".
// Sem isso a rotina roda às 03h e não conta a ninguém o que fez, e um silêncio
// que significa "deu certo" fica indistinguível de um que significa "não
// fechei". Nunca derruba o fechamento: falhar em AVISAR que fechou não pode
// desfazer o fechamento.
async function avisarGestao(resultado: unknown) {
  try {
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/clever-handler`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify({ action: "fechamento_concluido", resultado }),
    });
  } catch (e) {
    console.error("avisarGestao falhou:", e instanceof Error ? e.message : String(e));
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function metabase(apiKey: string, sql: string): Promise<unknown[]> {
  const form = new URLSearchParams();
  form.set("query", JSON.stringify({ database: DATABASE_ID, type: "native", native: { query: sql } }));
  const resp = await fetch(`${METABASE_URL}/api/dataset/json`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!resp.ok) throw new Error(`Metabase ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const dados = await resp.json();
  if (!Array.isArray(dados)) throw new Error(`Resposta inesperada: ${JSON.stringify(dados).slice(0, 300)}`);
  return dados;
}

// Ativações de PASS/FINES/PREMIUM vêm do MIN(receita_date) histórico por fonte:
// processar_comissoes só calcula um produto se a ativação E a receita existirem,
// e sem isso esses produtos seriam ignorados sem aviso nenhum.
const consultaFechamento = (ini: string, fim: string) => `
WITH periodo AS (SELECT DATE '${ini}' AS ini, DATE '${fim}' AS fim),
fuel AS (
  SELECT t.cliente_id, SUM(t.valor) AS tpv_fuel, SUM(t.receita) AS receita_fuel
  FROM prod_analytics.transacoes t, periodo p
  WHERE t.transacao_date BETWEEN p.ini AND p.fim GROUP BY 1),
ativ_fuel AS (SELECT cliente_id, MIN(transacao_date) AS d FROM prod_analytics.transacoes GROUP BY 1),
mens AS (
  SELECT r.cliente_id,
    SUM(CASE WHEN r.fonte_receita='pass' THEN r.valor_receita END) AS receita_pass,
    SUM(CASE WHEN r.fonte_receita='fines' THEN r.valor_receita END) AS receita_fines,
    SUM(CASE WHEN r.fonte_receita='premium' THEN r.valor_receita END) AS receita_premium
  FROM prod_analytics.receitas r, periodo p
  WHERE r.tipo_receita='mensalidade' AND r.receita_date BETWEEN p.ini AND p.fim GROUP BY 1),
ativ_mens AS (
  SELECT cliente_id,
    MIN(CASE WHEN fonte_receita='pass' THEN receita_date END) AS ativ_pass,
    MIN(CASE WHEN fonte_receita='fines' THEN receita_date END) AS ativ_fines,
    MIN(CASE WHEN fonte_receita='premium' THEN receita_date END) AS ativ_premium
  FROM prod_analytics.receitas WHERE tipo_receita='mensalidade' GROUP BY 1)
SELECT
  c.representante AS vendedor_nome, COALESCE(c.indicador,'') AS indicador_nome,
  c.cnpj_cpf AS cliente_cnpj, c.nome AS cliente_nome,
  CAST(af.d AS VARCHAR) AS ativacao_fuel,
  CAST(am.ativ_pass AS VARCHAR) AS ativacao_pass,
  CAST(am.ativ_fines AS VARCHAR) AS ativacao_fines,
  CAST(am.ativ_premium AS VARCHAR) AS ativacao_premium,
  f.tpv_fuel, f.receita_fuel, m.receita_pass, m.receita_fines, m.receita_premium,
  c.situacao
FROM prod_analytics.clientes c
LEFT JOIN fuel f ON f.cliente_id=c.cliente_id
LEFT JOIN mens m ON m.cliente_id=c.cliente_id
LEFT JOIN ativ_fuel af ON af.cliente_id=c.cliente_id
LEFT JOIN ativ_mens am ON am.cliente_id=c.cliente_id
WHERE COALESCE(c.representante,'') <> ''
  AND (f.receita_fuel IS NOT NULL OR m.receita_pass IS NOT NULL
       OR m.receita_fines IS NOT NULL OR m.receita_premium IS NOT NULL)`;

const consultaCompletude = (ini: string, fim: string) => `
SELECT
  SUM(CASE WHEN transacao_date = DATE '${fim}' THEN 1 ELSE 0 END) AS ultimo_dia,
  CAST(COUNT(*) AS DOUBLE) / CAST(DATE_DIFF('day', DATE '${ini}', DATE '${fim}') + 1 AS DOUBLE) AS media_diaria
FROM prod_analytics.transacoes
WHERE transacao_date BETWEEN DATE '${ini}' AND DATE '${fim}'`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("METABASE_API_KEY");
    if (!apiKey) return json({ ok: false, motivo: "METABASE_API_KEY não configurada" }, 400);

    // Permite forçar um período específico no corpo; por padrão fecha o mês anterior.
    const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const hoje = new Date();
    const alvo = corpo.periodo
      ? new Date(`${corpo.periodo}-01T12:00:00Z`)
      : new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));

    const ini = `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0));
    const fim = `${ultimoDia.getUTCFullYear()}-${String(ultimoDia.getUTCMonth() + 1).padStart(2, "0")}-${String(ultimoDia.getUTCDate()).padStart(2, "0")}`;

    // Trava de completude — só pulada com forcar:true, para um fechamento manual
    // consciente (ex.: mês de operação realmente atípica).
    if (!corpo.forcar) {
      const [c] = await metabase(apiKey, consultaCompletude(ini, fim)) as Array<Record<string, number>>;
      const razao = c && c.media_diaria > 0 ? c.ultimo_dia / c.media_diaria : 0;
      if (razao < LIMITE_COMPLETUDE) {
        const adiado = {
          ok: false, adiado: true, periodo: ini.slice(0, 7),
          motivo: "dados do último dia do mês parecem incompletos",
          ultimo_dia: c?.ultimo_dia ?? 0,
          media_diaria: Math.round(c?.media_diaria ?? 0),
          razao: Number(razao.toFixed(2)),
        };
        await avisarGestao(adiado);
        return json(adiado);
      }
    }

    const linhas = await metabase(apiKey, consultaFechamento(ini, fim));

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await supabase.rpc("executar_fechamento_mensal", {
      p_dados: linhas, p_periodo_inicio: ini, p_origem: "automatico",
    });
    if (error) {
      const falha = { ok: false, periodo: ini.slice(0, 7), error: error.message };
      await avisarGestao(falha);
      return json(falha, 400);
    }

    const resultado = { ...data, periodo: ini.slice(0, 7), clientes_lidos: linhas.length };
    await avisarGestao(resultado);
    return json(resultado);
  } catch (err) {
    const falha = { ok: false, error: err instanceof Error ? err.message : String(err) };
    await avisarGestao(falha);
    return json(falha, 400);
  }
});
