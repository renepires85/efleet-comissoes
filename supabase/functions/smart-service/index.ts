// Criação e envio de acesso ao ARGOS Comissões.
//
// Dois caminhos entram aqui:
//
//   { nome, email, perfil }  → convite avulso, da tela "Convidar". Cria o
//                              login e, para vendedor/indicador, liga ao
//                              cadastro de prestador correspondente.
//   { recuperar: email }     → "Esqueci minha senha" da tela de login.
//   { usuario_id }           → "Enviar acesso" de um usuário de gestão, que
//                              não tem linha em `prestadores`.
//   { prestador_id }         → botão "Enviar acesso" da aba Cadastros. Parte
//                              de um prestador que JÁ existe e resolve o que
//                              faltar: cria o login se não houver, religa se
//                              estiver solto, redefine a senha se já houver.
//
// O segundo caminho existe porque o primeiro não cobria a realidade: o parceiro
// costuma ser cadastrado primeiro (nome, documento, contrato, percentual) e só
// depois ganha acesso. Fazer isso pelo convite avulso criava um segundo
// registro e deixava contrato e clientes órfãos no primeiro.
//
// A senha provisória é gerada AQUI, no servidor, e não no navegador: assim não
// passa pelo console, pelo histórico da aba nem por log nenhum do cliente. Ela
// só aparece no e-mail — e, se o e-mail falhar, na resposta, para a gestão
// repassar por outro canal em vez de recomeçar.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Cliente com service_role: ignora RLS e libera a API Admin do Auth.
// Criado por chamada, dentro de cada handler, em vez de passado como parâmetro:
// sem um tipo `Database` gerado, o tipo do cliente atravessando a fronteira de
// função colapsa as tabelas para `never` e o `deno check` reprova tudo.
const criarCliente = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_URL = "https://efleet-comissoes.vercel.app";

// Alfabeto sem I/l/O/0/1 — a senha é lida de um e-mail e digitada à mão, e
// caractere ambíguo vira chamado de "não consigo entrar".
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function gerarSenha() {
  return "Argos" +
    Array.from(crypto.getRandomValues(new Uint8Array(9)))
      .map((b) => ALFABETO[b % ALFABETO.length])
      .join("") + "!";
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── E-MAIL ────────────────────────────────────────────────────────────────────
// Tabelas aninhadas e estilo inline, não flexbox: é o que Outlook e Gmail
// renderizam igual. Mesma moldura das notificações da clever-handler, para o
// parceiro reconhecer a origem da mensagem.

const PRIMEIRO_NOME = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

function corpoAcesso(nome: string, email: string, senha: string, papel: string, novo: boolean) {
  const saudacao = novo
    ? `A eFleet criou o seu acesso ao <strong>ARGOS · Comissões</strong>, onde você acompanha as suas comissões ${papel === "indicador" ? "de indicação" : "de venda"} mês a mês.`
    : `Geramos uma <strong>nova senha</strong> para o seu acesso ao ARGOS · Comissões. A senha anterior deixou de valer.`;

  const oQueEncontra = novo
    ? `
      <tr><td style="padding:0 28px 4px;">
        <p style="margin:0 0 8px;color:#0b1929;font-size:14px;font-weight:bold;">O que você encontra lá dentro</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr><td style="padding:3px 0;color:#374151;font-size:13.5px;">
            <span style="color:#A4C557;font-weight:bold;">•</span>
            &nbsp;<strong>Prévia do mês</strong> — estimativa do que está sendo gerado agora, atualizada todo dia.
          </td></tr>
          <tr><td style="padding:3px 0;color:#374151;font-size:13.5px;">
            <span style="color:#A4C557;font-weight:bold;">•</span>
            &nbsp;<strong>Comissões fechadas</strong> — o cálculo oficial de cada mês, cliente a cliente.
          </td></tr>
          <tr><td style="padding:3px 0;color:#374151;font-size:13.5px;">
            <span style="color:#A4C557;font-weight:bold;">•</span>
            &nbsp;<strong>Aprovação</strong> — é você quem confere e valida o valor antes do pagamento.
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 28px 0;"><div style="height:1px;background:#e6e9ef;"></div></td></tr>`
    : "";

  return `
    <tr><td style="padding:28px 28px 0;">
      <p style="margin:0 0 4px;color:#0b1929;font-size:20px;font-weight:bold;">Olá, ${PRIMEIRO_NOME(nome)}</p>
      <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.55;">${saudacao}</p>
    </td></tr>

    <tr><td style="padding:0 28px;">
      <table cellpadding="0" cellspacing="0" width="100%" style="background:#f5f7fa;border:1px solid #e6e9ef;border-radius:10px;">
        <tr><td style="padding:16px 18px;">
          <p style="margin:0 0 3px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.6px;">E-mail de acesso</p>
          <p style="margin:0 0 14px;color:#0b1929;font-size:15px;font-weight:bold;">${email}</p>
          <p style="margin:0 0 3px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.6px;">Senha provisória</p>
          <p style="margin:0;color:#0b1929;font-size:19px;font-weight:bold;font-family:'Courier New',Courier,monospace;letter-spacing:.5px;">${senha}</p>
        </td></tr>
      </table>
    </td></tr>

    <tr><td align="center" style="padding:22px 28px 4px;">
      <a href="${APP_URL}" style="display:inline-block;background:#245091;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:13px 30px;border-radius:8px;">Entrar no ARGOS →</a>
    </td></tr>

    <tr><td style="padding:14px 28px 20px;">
      <p style="margin:0;color:#6b7280;font-size:12.5px;line-height:1.55;">
        Na tela de login, escolha o perfil <strong>${papel === "indicador" ? "Indicador" : papel === "vendedor" ? "Vendedor" : "correspondente"}</strong>.
        Depois de entrar, troque a senha no botão <strong>Senha</strong> da barra superior — a provisória serve só para o primeiro acesso.
      </p>
    </td></tr>

    ${oQueEncontra}

    <tr><td style="padding:16px 28px 24px;">
      <p style="margin:0;color:#9aa3b2;font-size:11.5px;line-height:1.5;">
        Não compartilhe esta senha. Se você não esperava este e-mail, avise a eFleet e ignore a mensagem.
      </p>
    </td></tr>`;
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
          <p style="margin:0;color:#6b7280;font-size:11px;">Mensagem automática do sistema de Comissões · eFleet Digital. Não responda este e-mail.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function enviarEmailAcesso(nome: string, email: string, senha: string, papel: string, novo: boolean) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return false;
  const remetente = Deno.env.get("RESEND_FROM") ?? "eFleet · Comissões <onboarding@resend.dev>";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: remetente,
      to: [email],
      subject: novo ? "Seu acesso ao ARGOS · Comissões" : "Nova senha de acesso ao ARGOS · Comissões",
      html: layout(corpoAcesso(nome, email, senha, papel, novo)),
    }),
  });
  return resp.ok;
}


// ── RECUPERAÇÃO DE SENHA ──────────────────────────────────────────────────────
// Pelo Resend e não pelo e-mail nativo do Supabase: o remetente padrão dele tem
// limite baixo por hora e cai em spam com frequência: um e-mail de recuperação
// que não chega é o mesmo que não existir. O domínio da eFleet já está
// verificado no Resend e é o mesmo remetente das outras mensagens do sistema.

function corpoRecuperacao(nome: string, link: string) {
  return `
    <tr><td style="padding:28px 28px 0;">
      <p style="margin:0 0 4px;color:#0b1929;font-size:20px;font-weight:bold;">Olá, ${PRIMEIRO_NOME(nome)}</p>
      <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.55;">
        Recebemos um pedido para redefinir a sua senha do ARGOS · Comissões.
        Clique no botão abaixo para escolher uma nova.
      </p>
    </td></tr>

    <tr><td align="center" style="padding:4px 28px 8px;">
      <a href="${link}" style="display:inline-block;background:#245091;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:13px 30px;border-radius:8px;">Redefinir minha senha →</a>
    </td></tr>

    <tr><td style="padding:14px 28px 4px;">
      <p style="margin:0;color:#6b7280;font-size:12.5px;line-height:1.55;">
        O link vale por 1 hora e só pode ser usado uma vez. Se ele expirar, é só
        pedir de novo na tela de login.
      </p>
    </td></tr>

    <tr><td style="padding:16px 28px 24px;">
      <p style="margin:0;color:#9aa3b2;font-size:11.5px;line-height:1.5;">
        <strong>Não foi você?</strong> Ignore este e-mail. A sua senha atual continua
        valendo e nada muda enquanto o link não for aberto.
      </p>
    </td></tr>`;
}

async function recuperarSenha(email: string) {
  const alvo = (email ?? "").trim().toLowerCase();

  // Resposta idêntica exista ou não a conta. Responder diferente transformaria
  // esta tela num verificador de e-mails cadastrados para qualquer um.
  const resposta = {
    ok: true,
    mensagem: "Se este e-mail estiver cadastrado, o link de redefinição chega em instantes.",
  };
  if (!alvo || !alvo.includes("@")) return resposta;

  const sb = criarCliente();
  const { data: existe } = await sb.rpc("auth_user_id_por_email", { p_email: alvo });
  if (!existe) return resposta;

  const { data: perfil } = await sb
    .from("usuarios").select("nome").eq("id", existe as string).maybeSingle();

  const { data: link, error } = await sb.auth.admin.generateLink({
    type: "recovery",
    email: alvo,
    options: { redirectTo: APP_URL },
  });
  if (error || !link?.properties?.action_link) return resposta;

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    const remetente = Deno.env.get("RESEND_FROM") ?? "eFleet · Comissões <onboarding@resend.dev>";
    const envio = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: remetente,
        to: [alvo],
        subject: "Redefinir a sua senha do ARGOS · Comissões",
        html: layout(corpoRecuperacao((perfil as { nome?: string } | null)?.nome ?? alvo, link.properties.action_link)),
      }),
    });
    // A resposta ao usuário não pode mudar (senão vira verificador de e-mails),
    // mas a falha não pode sumir: sem este log, um e-mail de recuperação que
    // não sai fica indistinguível de um que saiu, para nós inclusive.
    if (!envio.ok) {
      console.error(`recuperar_senha: Resend ${envio.status} para ${alvo}: ${(await envio.text()).slice(0, 200)}`);
    }
  }
  return resposta;
}

// ── ENVIAR ACESSO A UM PRESTADOR JÁ CADASTRADO ────────────────────────────────
async function enviarAcessoPrestador(prestadorId: string) {
  const sb = criarCliente();
  const { data: p, error } = await sb
    .from("prestadores")
    .select("id, nome, email, usuario_id, tipo_parceiro, ativo")
    .eq("id", prestadorId)
    .single();

  if (error || !p) throw new Error("Prestador não encontrado.");
  const email = (p.email ?? "").trim();
  if (!email) throw new Error(`${p.nome} não tem e-mail cadastrado. Preencha em Editar antes de enviar o acesso.`);

  const papel = p.tipo_parceiro === "indicador" ? "indicador" : "vendedor";
  const senha = gerarSenha();

  // Reaproveitamos o login que já existir, em qualquer das duas formas em que
  // ele pode estar: apontado pelo prestador, ou solto no Auth com o mesmo
  // e-mail (cadastro e login criados em momentos diferentes, sem se ligarem).
  let userId: string | null = p.usuario_id ?? null;
  if (!userId) {
    const { data: achado } = await sb.rpc("auth_user_id_por_email", { p_email: email });
    userId = (achado as string | null) ?? null;
  }
  const novo = !userId;

  if (userId) {
    const { error: errUpd } = await sb.auth.admin.updateUserById(userId, {
      password: senha,
      email,
      email_confirm: true,
    });
    if (errUpd) throw new Error("Erro ao redefinir a senha: " + errUpd.message);
  } else {
    const { data: criado, error: errNovo } = await sb.auth.admin.createUser({
      email, password: senha, email_confirm: true,
    });
    if (errNovo) throw new Error("Erro ao criar o login: " + errNovo.message);
    userId = criado.user.id;
  }

  // `upsert` e não `insert`: o login pode existir sem a linha de perfil (foi
  // exatamente o estado em que o José Lucas ficou), e sem ela o sistema não
  // sabe qual tela abrir depois do login.
  const { error: errPerfil } = await sb
    .from("usuarios")
    .upsert({ id: userId, nome: p.nome, perfil: papel, senha_provisoria: true }, { onConflict: "id" });
  if (errPerfil) throw new Error("Erro no perfil: " + errPerfil.message);

  if (p.usuario_id !== userId) {
    const { error: errLink } = await sb
      .from("prestadores").update({ usuario_id: userId }).eq("id", p.id);
    if (errLink) throw new Error("Erro ao vincular: " + errLink.message);
  }

  let emailEnviado = false;
  try {
    emailEnviado = await enviarEmailAcesso(p.nome, email, senha, papel, novo);
  } catch (_) { /* acesso já existe; o que falhou foi o aviso */ }

  return {
    ok: true, nome: p.nome, email, novo, user_id: userId,
    email_enviado: emailEnviado,
    senha_provisoria: emailEnviado ? undefined : senha,
    aviso: p.ativo ? undefined : `${p.nome} está marcado como INATIVO — o acesso funciona, mas as comissões não aparecem nas telas.`,
  };
}

// ── ENVIAR ACESSO A UM USUÁRIO DE GESTÃO ──────────────────────────────────────
// Gestão não tem cadastro em `prestadores` — ela só existe em `usuarios`, e o
// e-mail mora no Auth. Por isso o caminho é separado do enviarAcessoPrestador:
// aqui o login sempre existe (é o que define a linha), então nunca há criação,
// só redefinição de senha.
async function enviarAcessoUsuario(usuarioId: string) {
  const sb = criarCliente();

  const { data: u, error } = await sb
    .from("usuarios").select("id, nome, perfil, ativo").eq("id", usuarioId).single();
  if (error || !u) throw new Error("Usuário não encontrado.");

  const { data: conta, error: errConta } = await sb.auth.admin.getUserById(usuarioId);
  if (errConta || !conta?.user?.email) throw new Error("Este usuário não tem login no Auth.");
  const email = conta.user.email;

  const senha = gerarSenha();
  const { error: errUpd } = await sb.auth.admin.updateUserById(usuarioId, {
    password: senha, email_confirm: true,
  });
  if (errUpd) throw new Error("Erro ao redefinir a senha: " + errUpd.message);

  const { error: errFlag } = await sb
    .from("usuarios").update({ senha_provisoria: true }).eq("id", usuarioId);
  if (errFlag) throw new Error("Erro ao marcar senha provisória: " + errFlag.message);

  let emailEnviado = false;
  try {
    emailEnviado = await enviarEmailAcesso(u.nome as string, email, senha, u.perfil as string, false);
  } catch (_) { /* senha já trocada; o que falhou foi o aviso */ }

  return {
    ok: true, nome: u.nome, email, novo: false, user_id: usuarioId,
    email_enviado: emailEnviado,
    senha_provisoria: emailEnviado ? undefined : senha,
    aviso: u.ativo ? undefined : `${u.nome} está com o acesso INATIVO — a senha nova só vale depois de reativar.`,
  };
}

// ── CONVITE AVULSO ────────────────────────────────────────────────────────────
async function convidar(nome: string, email: string, perfil: string, senhaRecebida?: string) {
  const sb = criarCliente();
  const senha = senhaRecebida ?? gerarSenha();

  const { data, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true });
  if (error) throw error;
  const userId = data.user.id;

  // senha_provisoria trava o login na tela de troca até a pessoa escolher a
  // dela. Toda senha que sai daqui é temporária por definição — ela trafega por
  // e-mail e nós a conhecemos.
  const { error: errUsuario } = await sb.from("usuarios")
    .insert({ id: userId, nome, perfil, senha_provisoria: true });
  if (errUsuario) throw new Error("Erro usuarios: " + errUsuario.message);

  // Na maioria dos casos o parceiro JÁ EXISTE em `prestadores`: alguém da
  // gestão cadastrou nome, documento, contrato e percentual antes, e o convite
  // é só o último passo. Por isso procuramos pelo e-mail e preenchemos o
  // usuario_id do cadastro existente — criar um segundo registro deixaria
  // contrato e vínculos de clientes órfãos no primeiro.
  if (perfil === "vendedor" || perfil === "indicador") {
    const { data: existente } = await sb
      .from("prestadores").select("id").eq("email", email).maybeSingle();

    if (existente) {
      const { error: errLink } = await sb
        .from("prestadores").update({ usuario_id: userId }).eq("id", existente.id);
      if (errLink) throw new Error("Erro ao vincular prestador: " + errLink.message);
    } else {
      const { error: errPrestador } = await sb.from("prestadores").insert({
        nome, email, usuario_id: userId, tipo: "PF", tipo_parceiro: perfil, ativo: true,
      });
      if (errPrestador) throw new Error("Erro prestadores: " + errPrestador.message);
    }
  }

  let emailEnviado = false;
  try {
    emailEnviado = await enviarEmailAcesso(nome, email, senha, perfil, true);
  } catch (_) { /* acesso já criado; o convite é o que falhou */ }

  return {
    ok: true, user_id: userId, nome, email, novo: true,
    email_enviado: emailEnviado,
    senha_provisoria: emailEnviado ? undefined : senha,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const corpo = await req.json();

    if (corpo.recuperar) {
      return json(await recuperarSenha(corpo.recuperar));
    }

    if (corpo.usuario_id) {
      return json(await enviarAcessoUsuario(corpo.usuario_id));
    }

    if (corpo.prestador_id) {
      return json(await enviarAcessoPrestador(corpo.prestador_id));
    }

    const { email, nome, perfil, senha } = corpo;
    if (!email || !nome || !perfil) throw new Error("email, nome e perfil são obrigatórios");
    return json(await convidar(nome, email, perfil, senha));
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
