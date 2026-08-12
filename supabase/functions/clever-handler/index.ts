// Notificações por e-mail do eFleet Comissões.
// Estrutura espelhada da função enviar-notificacao do Argos Pricing, que é a
// que comprovadamente funciona neste ambiente: serve() do std/http (a versão
// anterior usava `export default`, que o runtime não registra como servidor —
// toda requisição ficava pendurada até o gateway cortar em 150s).
//
// Remetente vem de RESEND_FROM. Enquanto o domínio não estiver verificado no
// Resend, o fallback sandbox só entrega ao dono da conta Resend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://efleet-comissoes.vercel.app";
const GESTAO_EMAIL = "argosefleet@gmail.com";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function layout(conteudo: string) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e6e9ef;overflow:hidden;">
        <tr><td style="background:#0b1929;padding:20px 28px;">
          <span style="color:#ffffff;font-size:16px;font-weight:bold;">eFleet · <span style="color:#A4C557;">Comissões</span></span>
        </td></tr>
        ${conteudo}
        <tr><td style="padding:16px 28px;border-top:1px solid #e6e9ef;">
          <p style="margin:0;color:#6b7280;font-size:11px;">Mensagem automática do sistema de Comissões · eFleet Digital. Não responda este email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function botao(texto: string) {
  return `<a href="${APP_URL}" style="display:inline-block;background:#245091;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 24px;border-radius:8px;">${texto} →</a>`;
}

async function enviarResend(resendKey: string, to: string[], subject: string, html: string) {
  const remetente = Deno.env.get("RESEND_FROM") ?? "eFleet · Comissões <onboarding@resend.dev>";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: remetente, to, subject, html }),
  });
  const resultado = await resp.json();
  if (!resp.ok) {
    throw new Error(`Resend: ${resultado.message ?? JSON.stringify(resultado)}`);
  }
  return resultado.id as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const body = await req.json();
    const action = body.action ?? "notificar_parceiro";

    // Sem chave configurada: responde sem erro, para não travar o fluxo de quem chamou.
    if (!resendKey) {
      return json({ ok: true, enviados: 0, motivo: "RESEND_API_KEY não configurada" });
    }

    // ─── Parceiro: comissões disponíveis para validação ───
    if (action === "notificar_parceiro") {
      const { prestador_id, periodo } = body;
      if (!prestador_id || !periodo) {
        return json({ ok: false, error: "prestador_id e periodo são obrigatórios" }, 400);
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: prestador } = await supabase
        .from("prestadores").select("nome, email").eq("id", prestador_id).single();

      if (!prestador) return json({ ok: false, error: "Prestador não encontrado" }, 404);
      if (!prestador.email) {
        return json({ ok: false, error: `${prestador.nome} não tem e-mail cadastrado` }, 400);
      }

      const id = await enviarResend(
        resendKey,
        [prestador.email],
        `eFleet · Suas comissões de ${periodo} estão disponíveis`,
        layout(`<tr><td style="padding:28px;">
          <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Comissões de ${periodo}</h2>
          <p style="margin:0 0 8px;color:#111827;font-size:14px;">Olá, <strong>${prestador.nome}</strong>!</p>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">Suas comissões já estão disponíveis para validação. Acesse o sistema, confira os valores e aprove até o dia 20.</p>
          ${botao("Acessar sistema")}
        </td></tr>`),
      );

      return json({ ok: true, enviados: 1, email: prestador.email, id });
    }

    // ─── Gestão: nova solicitação de acesso ───
    if (action === "nova_solicitacao") {
      const { solicitacao } = body;
      if (!solicitacao?.nome || !solicitacao?.email || !solicitacao?.tipo) {
        return json({ ok: false, error: "nome, email e tipo são obrigatórios" }, 400);
      }

      const tipoLabel = solicitacao.tipo === "gestao" ? "Gestão" : "Parceiro Comercial";
      const linha = (r: string, v: string) =>
        `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;">${r}</td><td style="padding:6px 0;color:#111827;font-size:13px;">${v}</td></tr>`;

      const id = await enviarResend(
        resendKey,
        [GESTAO_EMAIL],
        `eFleet · Nova solicitação de acesso — ${solicitacao.nome}`,
        layout(`<tr><td style="padding:28px;">
          <h2 style="margin:0 0 16px;color:#111827;font-size:20px;">Nova solicitação de acesso</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${linha("Nome", solicitacao.nome)}
            ${linha("E-mail", solicitacao.email)}
            ${linha("Telefone", solicitacao.telefone ?? "—")}
            ${linha("Tipo", tipoLabel)}
          </table>
          ${botao("Aprovar no sistema")}
        </td></tr>`),
      );

      return json({ ok: true, enviados: 1, id });
    }

    return json({ ok: false, error: `Action inválida: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, 400);
  }
});
