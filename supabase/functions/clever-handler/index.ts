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

type PendenteRow = {
  id: string;
  periodo_inicio: string;
  periodo_fim: string;
  criado_em: string;
  prestadores?: { id: string; nome: string; email: string | null; ativo: boolean } | null;
};
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

// Registra o envio — inclusive a falha. Um e-mail que não sai é
// indistinguível de um que sai quando nada fica guardado, e é justamente o que
// não sai que precisa de ação. Nunca derruba o fluxo: falhar em ANOTAR que o
// e-mail saiu não pode impedir que ele saia.
// deno-lint-ignore no-explicit-any
async function registrarEmail(supabase: any, registro: {
  tipo: string;
  destinatario: string;
  assunto?: string;
  prestador_id?: string | null;
  usuario_id?: string | null;
  referencia?: unknown;
  sucesso: boolean;
  erro?: string | null;
  provedor_id?: string | null;
}) {
  try {
    await supabase.from("emails_enviados").insert(registro);
  } catch (e) {
    console.error("registrarEmail falhou:", e instanceof Error ? e.message : String(e));
  }
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

      await registrarEmail(supabase, {
        tipo: "comissao_disponivel", destinatario: prestador.email,
        assunto: `eFleet · Suas comissões de ${periodo} estão disponíveis`,
        prestador_id, referencia: { periodo }, sucesso: true, provedor_id: id,
      });

      return json({ ok: true, enviados: 1, email: prestador.email, id });
    }

    // ─── Gestão: nova solicitação de acesso ───
    if (action === "nova_solicitacao") {
      const { solicitacao } = body;
      if (!solicitacao?.nome || !solicitacao?.email || !solicitacao?.tipo) {
        return json({ ok: false, error: "nome, email e tipo são obrigatórios" }, 400);
      }

      // Este ramo não precisava de banco até agora — só de e-mail. O cliente
      // entra aqui apenas para registrar o envio.
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

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

      await registrarEmail(supabase, {
        tipo: "solicitacao_acesso", destinatario: GESTAO_EMAIL,
        assunto: `eFleet · Nova solicitação de acesso — ${solicitacao.nome}`,
        referencia: { solicitante: solicitacao.nome, email: solicitacao.email, tipo: solicitacao.tipo },
        sucesso: true, provedor_id: id,
      });

      return json({ ok: true, enviados: 1, id });
    }

    // ─── Gestão: resultado do fechamento mensal ───
    // Chamada pela própria fechamento-mensal ao terminar. Sem isto, a rotina
    // que fecha o mês roda às 03h e não conta a ninguém o que fez — nem quando
    // se RECUSA a fechar pela trava de completude, que é o caso em que alguém
    // precisa agir. Um silêncio que significa "deu certo" e um silêncio que
    // significa "adiei" são indistinguíveis.
    if (action === "fechamento_concluido") {
      const { resultado } = body;
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: destinatarios } = await supabase.rpc("emails_gestao");
      // `so_para` manda para um endereço só, sem alterar mais nada. É o caminho
      // do meio entre simular (que não mostra o e-mail de verdade) e disparar
      // para o grupo inteiro — serve para conferir o conteúdo com olhos humanos
      // antes de atingir todo mundo.
      const emails = body?.so_para
        ? [String(body.so_para)]
        : (destinatarios ?? []).map((d: { email: string }) => d.email).filter(Boolean);
      if (!emails.length) return json({ ok: true, enviados: 0, motivo: "nenhum usuário de gestão ativo" });

      // O cron roda nos dias 3, 4 e 5 — os dois últimos existem como retentativa
      // caso a trava de completude adie o dia 3. Se o dia 3 deu certo, os dias
      // seguintes recebem 'periodo_ja_fechado', que é o sistema funcionando.
      // Sem este ramo, todo mês a gestão receberia dois "FECHAMENTO FALHOU"
      // com tudo em ordem — e um alarme que dispara sozinho todo mês é um
      // alarme que ninguém lê mais quando importa.
      if (resultado?.motivo === "periodo_ja_fechado") {
        return json({ ok: true, enviados: 0, motivo: "período já estava fechado, nada a avisar" });
      }

      const adiado = resultado?.adiado === true;
      const falhou = resultado?.ok === false && !adiado;
      const periodo = resultado?.periodo ?? "—";
      const fmtBRL2 = (n: number) => Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

      // Parceiros e total NÃO vêm no retorno de executar_fechamento_mensal —
      // ela devolve contagens de linhas, não o resultado financeiro. Buscamos
      // aqui, no fechamento recém-gravado.
      //
      // O primeiro fechamento real (agosto, em 02/09) chegou com "—" em três
      // campos e R$ 0,00 no total porque eu li nomes que não existem:
      // `comissoes`, `parceiros`, `total` e `validacoes`, quando a função
      // devolve `comissoes_geradas`, `linhas_fechamento` e `validacoes_criadas`.
      // O cálculo estava certo o tempo todo; o aviso é que mentia.
      // Separa ATIVO de INATIVO. Parceiro inativo entra no cálculo e some das
      // somas do sistema — regra antiga e deliberada. O aviso não seguia essa
      // regra, então anunciava R$ 1.132,34 enquanto o painel mostrava
      // R$ 969,67: a diferença eram R$ 162,67 de dois parceiros inativos, que
      // não serão pagos. Dois números certos medindo coisas diferentes, e quem
      // lê compara.
      let parceirosComValor = 0, totalCalculado = 0, suspensas = 0;
      let totalInativos = 0, parceirosInativos = 0;
      let validacoesAtivos = 0, validacoesInativos = 0;

      if (!adiado && !falhou && typeof periodo === "string" && /^\d{4}-\d{2}$/.test(periodo)) {
        const inicio = `${periodo}-01`;

        const { data: linhas } = await supabase
          .from("comissoes")
          .select("prestador_id, comissao_bruta, status, prestadores!inner(ativo)")
          .eq("periodo_inicio", inicio);

        const ativos = new Set<string>(), inativos = new Set<string>();
        for (const c of (linhas ?? []) as Array<Record<string, unknown>>) {
          const vivo = (c.prestadores as { ativo?: boolean } | null)?.ativo !== false;
          const v = Number(c.comissao_bruta ?? 0);
          if (c.status === "calculada") {
            if (vivo) { totalCalculado += v; if (v > 0) ativos.add(String(c.prestador_id)); }
            else      { totalInativos  += v; if (v > 0) inativos.add(String(c.prestador_id)); }
          }
          if (c.status === "suspensa" && vivo) suspensas++;
        }
        parceirosComValor = ativos.size;
        parceirosInativos = inativos.size;

        const { data: vals } = await supabase
          .from("validacoes_mensais")
          .select("id, prestadores!inner(ativo)")
          .eq("periodo_inicio", inicio);
        for (const v of (vals ?? []) as Array<Record<string, unknown>>) {
          if ((v.prestadores as { ativo?: boolean } | null)?.ativo !== false) validacoesAtivos++;
          else validacoesInativos++;
        }
      }

      const linhaResumo = (rotulo: string, valor: string) => `
        <tr><td style="padding:7px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;">${rotulo}</td>
            <td style="padding:7px 0;border-top:1px solid #e6e9ef;color:#111827;font-size:13px;text-align:right;font-weight:bold;">${valor}</td></tr>`;

      const corpo = adiado
        ? `<h2 style="margin:0 0 8px;color:#a5721a;font-size:20px;">⏸ Fechamento de ${periodo} adiado</h2>
           <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.55;">
             A rotina não fechou o mês porque os dados do último dia parecem incompletos —
             sinal de que a carga do Data Lake ainda não terminou. <strong>Nada foi gravado.</strong>
             A tentativa se repete automaticamente amanhã.
           </p>
           <table width="100%" cellpadding="0" cellspacing="0">
             ${linhaResumo("Transações no último dia", String(resultado?.ultimo_dia ?? "—"))}
             ${linhaResumo("Média diária do mês", String(resultado?.media_diaria ?? "—"))}
             ${linhaResumo("Proporção", `${resultado?.razao ?? "—"} (mínimo 0,4)`)}
           </table>
           <p style="margin:18px 0 0;color:#6b7280;font-size:12.5px;line-height:1.55;">
             Se isso se repetir por três dias seguidos, o problema é da carga, não do fechamento — vale acionar a equipe de dados.
           </p>`
        : falhou
        ? `<h2 style="margin:0 0 8px;color:#c0392b;font-size:20px;">✗ Fechamento de ${periodo} falhou</h2>
           <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.55;">
             A rotina não conseguiu concluir. <strong>Nenhuma comissão foi gerada</strong> e nada ficou pela metade.
           </p>
           <p style="margin:0;padding:12px 14px;background:#fdeaea;border-radius:8px;color:#7f1d1d;font-size:13px;font-family:monospace;">
             ${String(resultado?.error ?? "erro não informado").slice(0, 300)}
           </p>`
        : `<h2 style="margin:0 0 8px;color:#111827;font-size:20px;">✓ Fechamento de ${periodo} concluído</h2>
           <p style="margin:0 0 18px;color:#374151;font-size:14px;line-height:1.55;">
             O cálculo do mês rodou e as comissões já estão disponíveis para os parceiros aprovarem.
           </p>
           <table width="100%" cellpadding="0" cellspacing="0">
             ${linhaResumo("Clientes lidos", String(resultado?.clientes_lidos ?? "—"))}
             ${linhaResumo("Linhas do fechamento", String(resultado?.linhas_fechamento ?? "—"))}
             ${linhaResumo("Comissões geradas", String(resultado?.comissoes_geradas ?? "—"))}
             ${linhaResumo("Parceiros com valor a receber", String(parceirosComValor))}
             ${linhaResumo("<strong>Total a pagar</strong>", `<span style="font-size:15px;">${fmtBRL2(totalCalculado)}</span>`)}
             ${suspensas > 0 ? linhaResumo("Suspensas por inadimplência", String(suspensas)) : ""}
             ${linhaResumo("Validações aguardando aprovação", String(validacoesAtivos))}
           </table>
           ${totalInativos > 0 ? `
           <p style="margin:16px 0 0;padding:12px 14px;background:#f5f7fa;border-radius:8px;color:#6b7280;font-size:12.5px;line-height:1.55;">
             Fora do total: <strong style="color:#111827;">${fmtBRL2(totalInativos)}</strong> de
             ${parceirosInativos} parceiro(s) <strong>inativo(s)</strong>${validacoesInativos > 0 ? `, com ${validacoesInativos} validação(ões) que ninguém pode aprovar` : ""}.
             Comissão de parceiro inativo é calculada e registrada, mas não entra nas somas nem é paga.
             Se algum deles deveria estar ativo, é agora que dá para corrigir.
           </p>` : ""}
           <p style="margin:18px 0 0;color:#6b7280;font-size:12.5px;line-height:1.55;">
             A partir daqui a bola está com os parceiros: enquanto não aprovarem, o pagamento não avança.
             O lembrete diário cobra automaticamente.
           </p>`;

      const assunto = adiado
        ? `eFleet · Fechamento de ${periodo} adiado — dados incompletos`
        : falhou
        ? `eFleet · Fechamento de ${periodo} FALHOU`
        : `eFleet · Fechamento de ${periodo} concluído`;

      // A simulação devolve os NÚMEROS, não só o assunto: foi lendo campo
      // errado que o primeiro fechamento real avisou "concluído" com traços e
      // R$ 0,00. Simulação que não mostra o conteúdo não teria pego isso.
      if (body?.simular) {
        return json({
          ok: true, simulacao: true, destinatarios: emails, assunto, adiado, falhou,
          diria: {
            clientes_lidos: resultado?.clientes_lidos ?? null,
            linhas_fechamento: resultado?.linhas_fechamento ?? null,
            comissoes_geradas: resultado?.comissoes_geradas ?? null,
            parceiros_com_valor: parceirosComValor,
            total_a_pagar: totalCalculado,
            total_de_inativos: totalInativos,
            parceiros_inativos: parceirosInativos,
            validacoes_aguardando: validacoesAtivos,
            validacoes_de_inativos: validacoesInativos,
            suspensas,
            validacoes_criadas: resultado?.validacoes_criadas ?? null,
          },
        });
      }

      const id = await enviarResend(resendKey, emails, assunto,
        layout(`<tr><td style="padding:28px;">${corpo}
          <div style="margin-top:26px;">${botao("Abrir o sistema")}</div></td></tr>`));

      for (const e of emails) {
        await registrarEmail(supabase, {
          tipo: "fechamento_mensal", destinatario: e, assunto,
          referencia: { periodo, adiado, falhou, resultado }, sucesso: true, provedor_id: id,
        });
      }

      return json({ ok: true, enviados: emails.length, id });
    }

    // ─── Gestão: relatório semanal de pendências (fechamento + aprovações) ───
    // Disparado pelo pg_cron (ver migration 20260813_relatorio_semanal_gestao.sql),
    // toda segunda 08h — mas pode ser chamado manualmente sem parâmetros.
    // ── LEMBRETE AOS PARCEIROS ────────────────────────────────────────────────
    // O relatório semanal avisa a GESTÃO; este avisa o PARCEIRO. Sem ele, a
    // pendência só é vista por quem entra no sistema — e o Eduardo ficou com
    // junho parado desde 16/07, quase um mês, porque ninguém foi atrás dele.
    //
    // Só parceiro ATIVO recebe: o inativo não consegue entrar para aprovar, e
    // cobrar ação de quem não tem acesso é ruído.
    //
    // E só pendência COM VALOR A PAGAR. Havia aqui um comentário afirmando que
    // validação sem valor "já não existe mais, a trava impede que nasça". A
    // trava existe e funciona, mas vale só na criação: não alcança linha que
    // entrou por outro caminho. Era suposição no lugar de checagem, e o custo
    // apareceu — seis validações de agosto, sem comissão nenhuma, cobraram
    // aprovação por e-mail de um mês que nem tinha fechado.
    if (action === "lembrete_parceiros") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: pendentes, error } = await supabase
        .from("validacoes_mensais")
        .select("id, periodo_inicio, periodo_fim, criado_em, prestadores!inner(id, nome, email, ativo)")
        .eq("status", "pendente")
        .eq("prestadores.ativo", true);

      if (error) return json({ ok: false, error: error.message }, 400);
      if (!pendentes?.length) return json({ ok: true, enviados: 0, motivo: "nenhuma pendência" });

      // Cruza com as comissões: sem valor calculado no período não há o que
      // aprovar. Cobrar aprovação de zero gasta a confiança do parceiro no
      // aviso — na próxima vez, com dinheiro de verdade parado, ele já não abre.
      const ids = [...new Set((pendentes as unknown as PendenteRow[]).map(v => v.prestadores?.id).filter(Boolean))];
      const { data: comissoes } = await supabase
        .from("comissoes")
        .select("prestador_id, periodo_inicio, periodo_fim, comissao_bruta")
        .eq("status", "calculada")
        .in("prestador_id", ids as string[]);

      const valorPor = new Map<string, number>();
      for (const c of (comissoes ?? []) as Array<Record<string, unknown>>) {
        const k = `${c.prestador_id}|${c.periodo_inicio}|${c.periodo_fim}`;
        valorPor.set(k, (valorPor.get(k) ?? 0) + Number(c.comissao_bruta ?? 0));
      }

      const comValor = (pendentes as unknown as PendenteRow[]).filter(
        v => (valorPor.get(`${v.prestadores?.id}|${v.periodo_inicio}|${v.periodo_fim}`) ?? 0) > 0,
      );
      // `ignoradas` volta na resposta de propósito: linha pendente sem valor é
      // anomalia, e some sem deixar rastro se ninguém contar.
      const ignoradas = pendentes.length - comValor.length;
      if (!comValor.length) {
        return json({ ok: true, enviados: 0, motivo: "nenhuma pendência com valor a pagar", ignoradas });
      }

      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) return json({ ok: false, error: "RESEND_API_KEY não configurada" }, 400);

      // Agrupa por parceiro: quem tem três meses parados recebe UM e-mail, não três.
      const porParceiro = new Map<string, { id: string; nome: string; email: string; periodos: string[]; desde: string }>();
      for (const v of comValor) {
        const p = v.prestadores;
        if (!p?.email) continue;
        const mes = new Date(v.periodo_inicio + "T12:00:00")
          .toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
        const atual = porParceiro.get(p.id) ?? { id: p.id, nome: p.nome, email: p.email!, periodos: [], desde: v.criado_em };
        atual.periodos.push(mes);
        if (v.criado_em < atual.desde) atual.desde = v.criado_em;
        porParceiro.set(p.id, atual);
      }

      // Modo simulação: devolve quem RECEBERIA sem enviar nada.
      //
      // Existe porque testar este cron custava caro: cada verificação mandava
      // e-mail de verdade, e a Edite e a Luana receberam o mesmo lembrete três
      // vezes num dia só por causa dos meus testes. Verificar o comportamento
      // não pode ter como preço incomodar quem está do outro lado.
      if (body?.simular) {
        return json({
          ok: true, simulacao: true, ignoradas,
          enviaria: [...porParceiro.values()].map(p => ({
            nome: p.nome, email: p.email, periodos: p.periodos,
          })),
        });
      }

      let enviados = 0, semEmail = 0;
      for (const p of porParceiro.values()) {
        const dias = Math.floor((Date.now() - new Date(p.desde).getTime()) / 86400000);
        const lista = p.periodos.map(m => `<li style="margin:4px 0;">${m}</li>`).join("");
        const html = `
          <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1a2535;">
            <h2 style="color:#245091;margin:0 0 4px;">Você tem comissão para aprovar</h2>
            <p style="color:#606878;margin:0 0 18px;">Olá, ${p.nome}.</p>
            <p>${p.periodos.length === 1 ? "Há uma comissão aguardando" : `Há ${p.periodos.length} comissões aguardando`} sua aprovação:</p>
            <ul style="padding-left:20px;">${lista}</ul>
            <p><strong>Enquanto você não aprovar, o pagamento não avança.</strong></p>
            ${dias >= 15 ? `<p style="color:#c9302c;">A mais antiga está parada há ${dias} dias.</p>` : ""}
            <p style="margin-top:22px;">
              <a href="${APP_URL}" style="background:#A4C557;color:#0B1929;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;display:inline-block;">Abrir o sistema</a>
            </p>
            <p style="color:#606878;font-size:13px;margin-top:24px;">eFleet ARGOS · Comissões</p>
          </div>`;
        // enviarResend lança em erro; um parceiro com e-mail inválido não pode
        // impedir que os outros recebam.
        const assunto = "Você tem comissão para aprovar";
        try {
          const id = await enviarResend(resendKey, [p.email], assunto, html);
          enviados++;
          await registrarEmail(supabase, {
            tipo: "lembrete_parceiro", destinatario: p.email, assunto,
            prestador_id: p.id, referencia: { periodos: p.periodos, dias_parado: dias },
            sucesso: true, provedor_id: id,
          });
        } catch (e) {
          semEmail++;
          await registrarEmail(supabase, {
            tipo: "lembrete_parceiro", destinatario: p.email, assunto,
            prestador_id: p.id, referencia: { periodos: p.periodos, dias_parado: dias },
            sucesso: false, erro: e instanceof Error ? e.message : String(e),
          });
        }
      }

      // `ignoradas` sai na resposta de propósito: pendência sem valor é anomalia
      // na base, e uma anomalia que o filtro resolve em silêncio nunca é
      // investigada. O cron guarda o número; a gestão vê que existe.
      return json({ ok: true, enviados, falhas: semEmail, parceiros: porParceiro.size, ignoradas });
    }

    if (action === "relatorio_semanal") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { data: destinatarios } = await supabase.rpc("emails_gestao");
      // `so_para` manda para um endereço só, sem alterar mais nada. É o caminho
      // do meio entre simular (que não mostra o e-mail de verdade) e disparar
      // para o grupo inteiro — serve para conferir o conteúdo com olhos humanos
      // antes de atingir todo mundo.
      const emails = body?.so_para
        ? [String(body.so_para)]
        : (destinatarios ?? []).map((d: { email: string }) => d.email).filter(Boolean);
      if (!emails.length) {
        return json({ ok: true, enviados: 0, motivo: "nenhum usuário com perfil gestao ativo" });
      }

      const { data: fechamentosPendentes } = await supabase
        .from("uploads")
        .select("nome_arquivo, periodo_inicio, periodo_fim, criado_em")
        .neq("status", "concluido")
        .order("criado_em", { ascending: true });

      // Só parceiro ATIVO. Parceiro inativo não consegue entrar para aprovar —
      // cobrar da gestão que persiga alguém sem acesso é dar trabalho que não
      // tem como terminar. O MATHEUS sozinho, inativo, ocupava 9 das 13 linhas
      // e empurrava as reais para o fim da lista.
      const { data: validacoesPendentes } = await supabase
        .from("validacoes_mensais")
        .select("status, periodo_inicio, periodo_fim, criado_em, prestadores!inner(nome, ativo)")
        .in("status", ["pendente", "contestado"])
        .eq("prestadores.ativo", true)
        .order("status", { ascending: true })
        .order("criado_em", { ascending: true });

      // Quantas ficaram de fora, para a anomalia não sumir junto com o ruído.
      const { count: pendentesInativos } = await supabase
        .from("validacoes_mensais")
        .select("id, prestadores!inner(ativo)", { count: "exact", head: true })
        .in("status", ["pendente", "contestado"])
        .eq("prestadores.ativo", false);

      // Aprovadas que ninguém pagou. Faltava esta seção: o relatório cobria o
      // que espera o PARCEIRO agir e o que espera CÁLCULO, mas não o que espera
      // a gestão pagar — justamente a etapa em que o dinheiro fica parado
      // depois de todo mundo já ter concordado.
      const { data: aPagar } = await supabase
        .from("validacoes_mensais")
        .select("prestador_id, periodo_inicio, periodo_fim, aprovado_em, prestadores!inner(nome, ativo)")
        .eq("status", "aprovado")
        .eq("prestadores.ativo", true)
        .is("pago_em", null)
        .order("aprovado_em", { ascending: true });

      const { data: comsPagar } = await supabase
        .from("comissoes")
        .select("prestador_id, periodo_inicio, periodo_fim, comissao_bruta")
        .eq("status", "calculada")
        .in("prestador_id", [...new Set((aPagar ?? []).map((v: Record<string, unknown>) => v.prestador_id))]);

      const valorPagar = new Map<string, number>();
      for (const c of (comsPagar ?? []) as Array<Record<string, unknown>>) {
        const k = `${c.prestador_id}|${c.periodo_inicio}|${c.periodo_fim}`;
        valorPagar.set(k, (valorPagar.get(k) ?? 0) + Number(c.comissao_bruta ?? 0));
      }
      const valorDe = (v: Record<string, unknown>) =>
        valorPagar.get(`${v.prestador_id}|${v.periodo_inicio}|${v.periodo_fim}`) ?? 0;
      // Só o que tem valor a pagar. Sete das dez aprovadas em aberto valiam
      // R$ 0,00 — listá-las é pedir à gestão que pague nada, o mesmo ruído que
      // já tiramos da tela do parceiro e do lembrete. As zeradas viram um
      // contador no rodapé: some do relatório, não da vista.
      const aPagarComValor = (aPagar ?? []).filter(v => valorDe(v as Record<string, unknown>) > 0);
      const aPagarZeradas = (aPagar ?? []).length - aPagarComValor.length;
      const totalAPagar = aPagarComValor.reduce((t, v) => t + valorDe(v as Record<string, unknown>), 0);
      const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

      const fmtData = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR");
      const fmtPeriodo = (ini: string, fim: string) => `${fmtData(ini)} – ${fmtData(fim)}`;
      const diasDesde = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);

      const linhaFechamento = (u: { nome_arquivo: string; periodo_inicio: string; periodo_fim: string; criado_em: string }) => `
        <tr>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#111827;font-size:13px;">${u.nome_arquivo}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;">${fmtPeriodo(u.periodo_inicio, u.periodo_fim)}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;text-align:right;">${diasDesde(u.criado_em)}d</td>
        </tr>`;

      const linhaValidacao = (v: { status: string; periodo_inicio: string; periodo_fim: string; criado_em: string; prestadores: { nome: string } | null }) => `
        <tr>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#111827;font-size:13px;">${v.prestadores?.nome ?? "—"}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;">${fmtPeriodo(v.periodo_inicio, v.periodo_fim)}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;font-size:13px;text-align:center;">
            <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:bold;${
              v.status === "contestado" ? "background:#fde2e2;color:#c0392b;" : "background:#fef3d6;color:#a5721a;"
            }">${v.status === "contestado" ? "Contestado" : "Pendente"}</span>
          </td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;text-align:right;">${diasDesde(v.criado_em)}d</td>
        </tr>`;

      const secaoFechamentos = !fechamentosPendentes?.length
        ? `<p style="margin:0 0 24px;color:#6b7280;font-size:13px;">✓ Nenhum fechamento pendente de cálculo.</p>`
        : `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
             <tr><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Arquivo</th><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Período</th><th style="text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Enviado há</th></tr>
             ${fechamentosPendentes.map(linhaFechamento).join("")}
           </table>`;

      const secaoValidacoes = !validacoesPendentes?.length
        ? `<p style="margin:0;color:#6b7280;font-size:13px;">✓ Nenhuma validação pendente ou contestada.</p>`
        : `<table width="100%" cellpadding="0" cellspacing="0">
             <tr><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Parceiro</th><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Período</th><th style="text-align:center;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Status</th><th style="text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Há</th></tr>
             ${(validacoesPendentes as unknown as Parameters<typeof linhaValidacao>[0][]).map(linhaValidacao).join("")}
           </table>`;

      const linhaPagar = (v: Record<string, unknown>) => `
        <tr>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#111827;font-size:13px;">${(v.prestadores as { nome?: string } | null)?.nome ?? "—"}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;">${fmtPeriodo(v.periodo_inicio as string, v.periodo_fim as string)}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#111827;font-size:13px;text-align:right;font-weight:bold;">${fmtBRL(valorDe(v))}</td>
          <td style="padding:8px 0;border-top:1px solid #e6e9ef;color:#6b7280;font-size:13px;text-align:right;">${v.aprovado_em ? diasDesde(v.aprovado_em as string) + "d" : "—"}</td>
        </tr>`;

      const secaoPagar = !aPagarComValor.length
        ? `<p style="margin:0 0 24px;color:#6b7280;font-size:13px;">✓ Nada aprovado aguardando pagamento.</p>`
        : `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
             <tr><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Parceiro</th><th style="text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Período</th><th style="text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Valor</th><th style="text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;padding-bottom:6px;">Aprovado há</th></tr>
             ${aPagarComValor.map(v => linhaPagar(v as Record<string, unknown>)).join("")}
             <tr><td colspan="2" style="padding:10px 0;border-top:2px solid #0b1929;color:#111827;font-size:13px;font-weight:bold;">Total</td><td style="padding:10px 0;border-top:2px solid #0b1929;color:#0b1929;font-size:15px;font-weight:bold;text-align:right;">${fmtBRL(totalAPagar)}</td><td style="border-top:2px solid #0b1929;"></td></tr>
           </table>`;

      const hoje = new Date().toLocaleDateString("pt-BR");
      const html = layout(`<tr><td style="padding:28px;">
          <h2 style="margin:0 0 4px;color:#111827;font-size:20px;">Pendências da semana</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:13px;">Resumo gerado em ${hoje}</p>

          <h3 style="margin:0 0 10px;color:#111827;font-size:14px;">📁 Fechamentos pendentes de cálculo (${fechamentosPendentes?.length ?? 0})</h3>
          ${secaoFechamentos}

          <h3 style="margin:0 0 10px;color:#111827;font-size:14px;">✅ Aprovações pendentes (${validacoesPendentes?.length ?? 0})</h3>
          ${secaoValidacoes}
          ${pendentesInativos ? `<p style="margin:10px 0 0;color:#9aa3b2;font-size:12px;">${pendentesInativos} pendência(s) de parceiro inativo não ${pendentesInativos === 1 ? "foi listada" : "foram listadas"} — sem acesso, não têm como aprovar.</p>` : ""}

          <h3 style="margin:24px 0 10px;color:#111827;font-size:14px;">💰 Aprovadas aguardando pagamento (${aPagarComValor.length})</h3>
          ${secaoPagar}
          ${aPagarZeradas > 0 ? `<p style="margin:-14px 0 24px;color:#9aa3b2;font-size:12px;">${aPagarZeradas} aprovada(s) sem valor a pagar não ${aPagarZeradas === 1 ? "foi listada" : "foram listadas"}.</p>` : ""}

          <div style="margin-top:28px;">${botao("Abrir o sistema")}</div>
        </td></tr>`);

      const totalPend = (fechamentosPendentes?.length ?? 0) + (validacoesPendentes?.length ?? 0) + aPagarComValor.length;
      // Simulação: devolve o que iria no e-mail sem mandar nada. Testar o
      // relatório custava a caixa de entrada da gestão — a Kamily e a Alice
      // receberam cinco mensagens de teste minhas hoje.
      if (body?.simular) {
        return json({
          ok: true, simulacao: true, destinatarios: emails,
          fechamentos: fechamentosPendentes?.length ?? 0,
          validacoes: validacoesPendentes?.length ?? 0,
          validacoes_inativos: pendentesInativos ?? 0,
          a_pagar: aPagarComValor.length, total_a_pagar: totalAPagar,
          a_pagar_zeradas: aPagarZeradas,
          detalhe_a_pagar: aPagarComValor.map(v => ({
            parceiro: ((v as Record<string, unknown>).prestadores as { nome?: string } | null)?.nome,
            periodo: fmtPeriodo((v as Record<string, unknown>).periodo_inicio as string, (v as Record<string, unknown>).periodo_fim as string),
            valor: valorDe(v as Record<string, unknown>),
          })),
        });
      }

      const id = await enviarResend(
        resendKey,
        emails,
        totalPend > 0
          ? `eFleet · ${totalPend} pendência(s) aguardando você`
          : "eFleet · Nenhuma pendência esta semana",
        html,
      );

      for (const e of emails) {
        await registrarEmail(supabase, {
          tipo: "relatorio_semanal", destinatario: e,
          assunto: totalPend > 0
            ? `eFleet · ${totalPend} pendência(s) aguardando você`
            : "eFleet · Nenhuma pendência esta semana",
          referencia: {
            fechamentos: fechamentosPendentes?.length ?? 0,
            validacoes: validacoesPendentes?.length ?? 0,
            a_pagar: aPagarComValor.length,
            total_a_pagar: totalAPagar,
            a_pagar_zeradas: aPagarZeradas,
          },
          sucesso: true, provedor_id: id,
        });
      }

      return json({
        ok: true, enviados: emails.length,
        fechamentos: fechamentosPendentes?.length ?? 0,
        validacoes: validacoesPendentes?.length ?? 0,
        validacoes_inativos: pendentesInativos ?? 0,
        a_pagar: aPagarComValor.length, total_a_pagar: totalAPagar,
        a_pagar_zeradas: aPagarZeradas, id,
      });
    }

    return json({ ok: false, error: `Action inválida: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, 400);
  }
});
