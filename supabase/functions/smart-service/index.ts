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

// Registra o envio — inclusive a falha. Nunca derruba o fluxo: falhar em
// ANOTAR que o e-mail saiu não pode impedir que ele saia, nem desfazer um
// acesso que já foi criado.
// deno-lint-ignore no-explicit-any
async function registrarEmail(sb: any, registro: {
  tipo: string; destinatario: string; assunto?: string;
  prestador_id?: string | null; usuario_id?: string | null;
  referencia?: unknown; sucesso: boolean; erro?: string | null; provedor_id?: string | null;
}) {
  try {
    await sb.from("emails_enviados").insert(registro);
  } catch (e) {
    console.error("registrarEmail falhou:", e instanceof Error ? e.message : String(e));
  }
}

async function enviarEmailAcesso(nome: string, email: string, senha: string, papel: string, novo: boolean) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return { ok: false, id: null, erro: "RESEND_API_KEY não configurada" };
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
  // Devolve o id do Resend, não só sucesso/falha: sem ele não há como rastrear
  // depois "o que aconteceu com AQUELE e-mail". Custou uma investigação — um
  // parceiro disse não ter recebido, o registro dizia enviado, e faltava
  // exatamente o id para perguntar ao provedor.
  if (!resp.ok) return { ok: false, id: null, erro: `Resend ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
  const corpo = await resp.json().catch(() => ({}));
  return { ok: true, id: (corpo as { id?: string }).id ?? null, erro: null };
}


// ── RECUPERAÇÃO DE SENHA ──────────────────────────────────────────────────────
// Pelo Resend e não pelo e-mail nativo do Supabase: o remetente padrão dele tem
// limite baixo por hora e cai em spam com frequência: um e-mail de recuperação
// que não chega é o mesmo que não existir. O domínio da eFleet já está
// verificado no Resend e é o mesmo remetente das outras mensagens do sistema.

function corpoRecuperacao(nome: string, codigo: string) {
  return `
    <tr><td style="padding:28px 28px 0;">
      <p style="margin:0 0 4px;color:#0b1929;font-size:20px;font-weight:bold;">Olá, ${PRIMEIRO_NOME(nome)}</p>
      <p style="margin:0 0 20px;color:#374151;font-size:14px;line-height:1.55;">
        Recebemos um pedido para redefinir a sua senha do ARGOS · Comissões.
        Digite o código abaixo na tela do sistema para escolher uma nova.
      </p>
    </td></tr>

    <tr><td style="padding:0 28px;">
      <table cellpadding="0" cellspacing="0" width="100%" style="background:#f5f7fa;border:1px solid #e6e9ef;border-radius:10px;">
        <tr><td align="center" style="padding:20px 18px;">
          <p style="margin:0 0 6px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.6px;">Seu código</p>
          <p style="margin:0;color:#0b1929;font-size:30px;font-weight:bold;font-family:'Courier New',Courier,monospace;letter-spacing:7px;">${codigo}</p>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:18px 28px 4px;">
      <p style="margin:0;color:#6b7280;font-size:12.5px;line-height:1.55;">
        O código vale por 1 hora e só pode ser usado uma vez. Se ele expirar,
        peça outro na mesma tela.
      </p>
    </td></tr>

    <tr><td style="padding:16px 28px 24px;">
      <p style="margin:0;color:#9aa3b2;font-size:11.5px;line-height:1.5;">
        <strong>Não foi você?</strong> Ignore este e-mail. A sua senha atual continua
        valendo e nada muda enquanto o código não for usado.
      </p>
    </td></tr>`;
}

async function recuperarSenha(email: string) {
  const alvo = (email ?? "").trim().toLowerCase();

  // Resposta idêntica exista ou não a conta. Responder diferente transformaria
  // esta tela num verificador de e-mails cadastrados para qualquer um.
  const resposta = {
    ok: true,
    mensagem: "Se este e-mail estiver cadastrado, o código chega em instantes.",
  };
  if (!alvo || !alvo.includes("@")) return resposta;

  const sb = criarCliente();
  const { data: existe } = await sb.rpc("auth_user_id_por_email", { p_email: alvo });
  if (!existe) return resposta;

  const { data: perfil } = await sb
    .from("usuarios").select("nome").eq("id", existe as string).maybeSingle();

  // Geramos o link só para extrair dele o `email_otp`; o action_link NÃO vai no
  // e-mail. Verificadores de segurança de e-mail (Google Workspace, Outlook)
  // abrem os links das mensagens antes do destinatário, e o token é de uso
  // único — na prática o link chegava sempre queimado, e o sistema devolvia a
  // tela de login sem explicar nada. Código digitado não tem esse problema:
  // scanner nenhum digita.
  //
  // Link e código são o MESMO token, então mandar os dois não seria um
  // fallback: o scanner queimaria os dois juntos.
  const { data: link, error } = await sb.auth.admin.generateLink({
    type: "recovery",
    email: alvo,
    options: { redirectTo: APP_URL },
  });
  if (error || !link?.properties?.email_otp) return resposta;

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    const remetente = Deno.env.get("RESEND_FROM") ?? "eFleet · Comissões <onboarding@resend.dev>";
    const envio = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: remetente,
        to: [alvo],
        subject: "Seu código para redefinir a senha do ARGOS",
        html: layout(corpoRecuperacao((perfil as { nome?: string } | null)?.nome ?? alvo, link.properties.email_otp)),
      }),
    });
    // A resposta ao usuário não pode mudar (senão vira verificador de e-mails),
    // mas a falha não pode sumir: sem este registro, um e-mail de recuperação
    // que não sai fica indistinguível de um que saiu, para nós inclusive.
    //
    // O CÓDIGO nunca entra em `referencia` — quem tem acesso à tabela poderia
    // redefinir a senha de qualquer pessoa lendo o histórico. Guardamos que o
    // e-mail saiu, não o que ele continha.
    const erroEnvio = envio.ok ? null : `Resend ${envio.status}: ${(await envio.text()).slice(0, 200)}`;
    if (erroEnvio) console.error(`recuperar_senha para ${alvo}: ${erroEnvio}`);

    await registrarEmail(sb, {
      tipo: "recuperacao_senha", destinatario: alvo,
      assunto: "Seu código para redefinir a senha do ARGOS",
      usuario_id: existe as string,
      sucesso: envio.ok, erro: erroEnvio,
    });
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

  let envio: { ok: boolean; id: string | null; erro: string | null } = { ok: false, id: null, erro: "não tentado" };
  try {
    envio = await enviarEmailAcesso(p.nome, email, senha, papel, novo);
  } catch (e) { envio = { ok: false, id: null, erro: e instanceof Error ? e.message : String(e) }; }
  const emailEnviado = envio.ok;

  await registrarEmail(sb, {
    tipo: novo ? "acesso_criado" : "acesso_reenviado", destinatario: email,
    assunto: novo ? "Seu acesso ao ARGOS · Comissões" : "Nova senha de acesso ao ARGOS · Comissões",
    prestador_id: p.id as string, usuario_id: userId,
    referencia: { perfil: papel, origem: "prestador" },
    sucesso: emailEnviado, erro: envio.erro, provedor_id: envio.id,
  });

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

  let envio: { ok: boolean; id: string | null; erro: string | null } = { ok: false, id: null, erro: "não tentado" };
  try {
    envio = await enviarEmailAcesso(u.nome as string, email, senha, u.perfil as string, false);
  } catch (e) { envio = { ok: false, id: null, erro: e instanceof Error ? e.message : String(e) }; }
  const emailEnviado = envio.ok;

  await registrarEmail(sb, {
    tipo: "acesso_reenviado", destinatario: email,
    assunto: "Nova senha de acesso ao ARGOS · Comissões",
    usuario_id: usuarioId, referencia: { perfil: u.perfil, origem: "usuario_gestao" },
    sucesso: emailEnviado, erro: envio.erro, provedor_id: envio.id,
  });

  return {
    ok: true, nome: u.nome, email, novo: false, user_id: usuarioId,
    email_enviado: emailEnviado,
    senha_provisoria: emailEnviado ? undefined : senha,
    aviso: u.ativo ? undefined : `${u.nome} está com o acesso INATIVO — a senha nova só vale depois de reativar.`,
  };
}


// ── MANUAL DO PARCEIRO ────────────────────────────────────────────────────────
// Enviado UMA VEZ, quando a pessoa conclui o primeiro acesso — o momento em que
// ela acabou de criar a própria senha e está com o sistema aberto pela primeira
// vez. O controle de "uma vez" sai da própria tabela `emails_enviados`: ela já
// existe para responder quem recebeu o quê, e uma segunda fonte de verdade só
// divergiria da primeira.
//
// Não vai para gestão: o texto fala de aprovar comissão, contestar valor e
// dados bancários, que não são o trabalho dela.
function corpoManual(nome: string) {
  return `<tr><td style="padding:30px 30px 0;">
    <p style="margin:0 0 16px;color:#0b1929;font-size:22px;font-weight:bold;">Olá, ${PRIMEIRO_NOME(nome)}!</p>
    <p style="margin:0 0 8px;color:#374151;font-size:14.5px;line-height:1.65;">
      O <strong>Argos</strong> é o portal oficial para acompanhar suas comissões na eFleet.
      Nele, você consulta valores, entende cada cálculo, aprova ou contesta uma comissão
      e mantém seus dados de pagamento atualizados.
    </p>
  </td></tr>

  <!-- 1 -->
  <tr><td style="padding:26px 30px 0;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td width="26" valign="top"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#245091;color:#fff;border-radius:50%;font-size:12px;font-weight:bold;">1</span></td>
      <td><p style="margin:0;color:#0b1929;font-size:16.5px;font-weight:bold;line-height:22px;">Primeiro acesso</p></td>
    </tr></table>
    <div style="padding-left:26px;">
      <p style="margin:12px 0 10px;color:#374151;font-size:14px;line-height:1.65;">
        Entre em <a href="https://efleet-comissoes.vercel.app" style="color:#245091;font-weight:bold;">efleet-comissoes.vercel.app</a>
        utilizando seu e-mail e a senha provisória recebida.
      </p>
      <p style="margin:0 0 10px;color:#374151;font-size:14px;line-height:1.65;">
        No primeiro acesso, será obrigatório criar uma senha própria. Depois, você poderá
        alterá-la pelo botão <strong>Senha</strong>.
      </p>
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.65;">
        Caso esqueça, clique em <strong>Esqueci minha senha</strong>. Você receberá por e-mail
        um código de 8 dígitos, válido por 1 hora e para uma única utilização.
      </p>
    </div>
  </td></tr>

  <!-- 2 -->
  <tr><td style="padding:26px 30px 0;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td width="26" valign="top"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#245091;color:#fff;border-radius:50%;font-size:12px;font-weight:bold;">2</span></td>
      <td><p style="margin:0;color:#0b1929;font-size:16.5px;font-weight:bold;line-height:22px;">Acompanhe suas comissões</p></td>
    </tr></table>
    <div style="padding-left:26px;">
      <p style="margin:12px 0 10px;color:#374151;font-size:14px;line-height:1.65;">Na tela principal, você encontra:</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:3px 0;color:#374151;font-size:14px;line-height:1.6;"><span style="color:#A4C557;font-weight:bold;">•</span>&nbsp; Comissão do mês em destaque</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:14px;line-height:1.6;"><span style="color:#A4C557;font-weight:bold;">•</span>&nbsp; Valor acumulado</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:14px;line-height:1.6;"><span style="color:#A4C557;font-weight:bold;">•</span>&nbsp; Separação entre comissões de FUEL e mensalidades</td></tr>
        <tr><td style="padding:3px 0;color:#374151;font-size:14px;line-height:1.6;"><span style="color:#A4C557;font-weight:bold;">•</span>&nbsp; Filtros por mês atual, mês anterior, últimos três meses ou período personalizado</td></tr>
      </table>
    </div>
  </td></tr>

  <!-- 3 -->
  <tr><td style="padding:26px 30px 0;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td width="26" valign="top"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#245091;color:#fff;border-radius:50%;font-size:12px;font-weight:bold;">3</span></td>
      <td><p style="margin:0;color:#0b1929;font-size:16.5px;font-weight:bold;line-height:22px;">A diferença entre prévia e comissão fechada</p></td>
    </tr></table>
    <div style="padding-left:26px;">

      <table cellpadding="0" cellspacing="0" width="100%" style="background:#fff8ec;border-left:3px solid #F0C040;border-radius:0 8px 8px 0;margin:14px 0 12px;">
        <tr><td style="padding:14px 16px;">
          <p style="margin:0 0 6px;color:#0b1929;font-size:14.5px;font-weight:bold;">⏳ Prévia do mês em andamento</p>
          <p style="margin:0 0 10px;color:#374151;font-size:14px;line-height:1.6;">
            É uma <strong>estimativa</strong> atualizada diariamente. O valor pode mudar até o fechamento do mês.
          </p>
          <p style="margin:0 0 6px;color:#374151;font-size:14px;line-height:1.6;">Na prévia, você acompanha:</p>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:2px 0;color:#374151;font-size:13.5px;">•&nbsp; Total calculado</td></tr>
            <tr><td style="padding:2px 0;color:#374151;font-size:13.5px;">•&nbsp; Valor validado</td></tr>
            <tr><td style="padding:2px 0;color:#374151;font-size:13.5px;">•&nbsp; Valor bloqueado</td></tr>
            <tr><td style="padding:2px 0;color:#374151;font-size:13.5px;">•&nbsp; Data e hora da última atualização</td></tr>
            <tr><td style="padding:2px 0;color:#374151;font-size:13.5px;">•&nbsp; Clientes que compõem o cálculo</td></tr>
          </table>
          <p style="margin:10px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
            A lista de clientes fica recolhida. Para visualizar, clique em <strong>Ver clientes</strong>.
          </p>
        </td></tr>
      </table>

      <table cellpadding="0" cellspacing="0" width="100%" style="background:#f2f7ec;border-left:3px solid #A4C557;border-radius:0 8px 8px 0;">
        <tr><td style="padding:14px 16px;">
          <p style="margin:0 0 6px;color:#0b1929;font-size:14.5px;font-weight:bold;">✓ Comissão fechada</p>
          <p style="margin:0 0 10px;color:#374151;font-size:14px;line-height:1.6;">
            É o cálculo oficial de um período já encerrado. Fica disponível no <strong>dia 3</strong> de cada mês,
            referente ao mês anterior.
          </p>
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">
            Você deverá conferir e escolher entre <strong>Aprovar</strong> ou <strong>Contestar</strong>.
            Enquanto essa ação não for realizada, a comissão não seguirá para pagamento.
          </p>
        </td></tr>
      </table>
    </div>
  </td></tr>

  <!-- 4 -->
  <tr><td style="padding:26px 30px 0;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td width="26" valign="top"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#245091;color:#fff;border-radius:50%;font-size:12px;font-weight:bold;">4</span></td>
      <td><p style="margin:0;color:#0b1929;font-size:16.5px;font-weight:bold;line-height:22px;">Consulte o detalhamento</p></td>
    </tr></table>
    <div style="padding-left:26px;">
      <p style="margin:12px 0 8px;color:#374151;font-size:14px;line-height:1.65;">Cada linha apresenta:</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Cliente e produto</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Mês da curva e percentual de ramp</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Base de cálculo</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Valor da comissão</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Status</td></tr>
      </table>
      <p style="margin:14px 0 8px;color:#374151;font-size:14px;line-height:1.65;">
        Ao clicar no nome do cliente, você também poderá consultar:
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Data da primeira transação e da primeira mensalidade</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; TPV do mês</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Receita FUEL utilizada no cálculo</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Percentual aplicado</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Mensalidades</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Situação do cliente e motivo de eventual bloqueio</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; CNPJ</td></tr>
      </table>
    </div>
  </td></tr>

  <!-- 5 -->
  <tr><td style="padding:26px 30px 0;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td width="26" valign="top"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#245091;color:#fff;border-radius:50%;font-size:12px;font-weight:bold;">5</span></td>
      <td><p style="margin:0;color:#0b1929;font-size:16.5px;font-weight:bold;line-height:22px;">Aprove ou conteste</p></td>
    </tr></table>
    <div style="padding-left:26px;">
      <p style="margin:12px 0 10px;color:#374151;font-size:14px;line-height:1.65;">
        Ao clicar em <strong>Aprovar</strong>, o Argos mostrará o valor para sua confirmação.
        Depois da aprovação, não será possível desfazer a ação diretamente no portal.
      </p>
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.65;">
        Se identificar alguma divergência, clique em <strong>Contestar</strong> e descreva o que
        não corresponde ao esperado. A eFleet analisará o apontamento antes de liberar o valor.
      </p>
    </div>
  </td></tr>

  <!-- 6 -->
  <tr><td style="padding:26px 30px 0;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td width="26" valign="top"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#245091;color:#fff;border-radius:50%;font-size:12px;font-weight:bold;">6</span></td>
      <td><p style="margin:0;color:#0b1929;font-size:16.5px;font-weight:bold;line-height:22px;">Atualize seus dados de pagamento</p></td>
    </tr></table>
    <div style="padding-left:26px;">
      <p style="margin:12px 0 8px;color:#374151;font-size:14px;line-height:1.65;">
        No botão <strong>Dados bancários</strong>, você poderá cadastrar ou atualizar:
      </p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Banco, agência e conta</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Tipo de conta</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Chave PIX</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Telefone</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; CPF do responsável</td></tr>
      </table>
      <p style="margin:12px 0 10px;color:#374151;font-size:14px;line-height:1.65;">
        Confira os dados antes do primeiro pagamento. Informações incorretas ou desatualizadas
        podem atrasar o processo.
      </p>
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.65;">
        Você também poderá baixar o extrato da comissão em <strong>PDF</strong> para conferência
        e apoio na emissão da Nota Fiscal.
      </p>
    </div>
  </td></tr>

  <!-- 7 -->
  <tr><td style="padding:26px 30px 0;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td width="26" valign="top"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#245091;color:#fff;border-radius:50%;font-size:12px;font-weight:bold;">7</span></td>
      <td><p style="margin:0;color:#0b1929;font-size:16.5px;font-weight:bold;line-height:22px;">Acompanhe os avisos</p></td>
    </tr></table>
    <div style="padding-left:26px;">
      <p style="margin:12px 0 10px;color:#374151;font-size:14px;line-height:1.65;">
        O Argos exibe um aviso vermelho sempre que existir uma comissão aguardando sua aprovação,
        independentemente do período que estiver sendo consultado.
      </p>
      <p style="margin:0 0 8px;color:#374151;font-size:14px;line-height:1.65;">Você também receberá:</p>
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Lembrete diário enquanto houver valor aguardando aprovação</td></tr>
        <tr><td style="padding:2px 0;color:#374151;font-size:14px;">•&nbsp; Avisos de criação de acesso, redefinição e recuperação de senha</td></tr>
      </table>
    </div>
  </td></tr>

  <tr><td style="padding:26px 30px 0;">
    <div style="height:1px;background:#e6e9ef;"></div>
  </td></tr>

  <tr><td style="padding:20px 30px 0;">
    <p style="margin:0;color:#374151;font-size:14px;line-height:1.65;">
      Seu acesso é individual e apresenta somente seus clientes e comissões.
      <strong>Nome, documento, percentual, contrato e situação cadastral são administrados pela eFleet.</strong>
    </p>
  </td></tr>

  <tr><td align="center" style="padding:24px 30px 8px;">
    <a href="https://efleet-comissoes.vercel.app" style="display:inline-block;background:#245091;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 34px;border-radius:8px;">Acessar o Argos →</a>
  </td></tr>

  <tr><td style="padding:16px 30px 26px;">
    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.65;">
      Em caso de dúvida sobre um valor, utilize o botão <strong>Contestar</strong>. Assim, sua
      solicitação chegará acompanhada de todo o detalhamento necessário para análise.
    </p>
  </td></tr>`;
}

async function enviarManualParceiro(usuarioId: string) {
  const sb = criarCliente();

  const { data: u } = await sb
    .from("usuarios").select("nome, perfil").eq("id", usuarioId).maybeSingle();
  if (!u) return { ok: false, motivo: "usuário não encontrado" };
  if (u.perfil !== "vendedor" && u.perfil !== "indicador") {
    return { ok: true, enviado: false, motivo: "manual é só para parceiro" };
  }

  const { data: jaFoi } = await sb
    .from("emails_enviados")
    .select("id")
    .eq("tipo", "manual_parceiro")
    .eq("usuario_id", usuarioId)
    .eq("sucesso", true)
    .limit(1);
  if (jaFoi?.length) return { ok: true, enviado: false, motivo: "manual já enviado antes" };

  const { data: conta } = await sb.auth.admin.getUserById(usuarioId);
  const email = conta?.user?.email;
  if (!email) return { ok: false, motivo: "sem e-mail" };

  const assunto = "Argos · seu portal de comissões";
  const resendKey = Deno.env.get("RESEND_API_KEY");
  let ok = false, erro: string | null = null;
  if (resendKey) {
    const remetente = Deno.env.get("RESEND_FROM") ?? "eFleet · Comissões <onboarding@resend.dev>";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: remetente, to: [email], subject: assunto,
        html: layout(corpoManual(u.nome as string)) }),
    });
    ok = r.ok;
    if (!ok) erro = `Resend ${r.status}: ${(await r.text()).slice(0, 200)}`;
  } else {
    erro = "RESEND_API_KEY não configurada";
  }

  await registrarEmail(sb, {
    tipo: "manual_parceiro", destinatario: email, assunto,
    usuario_id: usuarioId, referencia: { perfil: u.perfil, gatilho: "primeiro acesso" },
    sucesso: ok, erro,
  });

  return { ok: true, enviado: ok, erro };
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

  let envio: { ok: boolean; id: string | null; erro: string | null } = { ok: false, id: null, erro: "não tentado" };
  try {
    envio = await enviarEmailAcesso(nome, email, senha, perfil, true);
  } catch (e) { envio = { ok: false, id: null, erro: e instanceof Error ? e.message : String(e) }; }
  const emailEnviado = envio.ok;

  await registrarEmail(sb, {
    tipo: "acesso_criado", destinatario: email,
    assunto: "Seu acesso ao ARGOS · Comissões",
    usuario_id: userId, referencia: { perfil, origem: "convite" },
    sucesso: emailEnviado, erro: envio.erro, provedor_id: envio.id,
  });

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

    if (corpo.manual_para) {
      return json(await enviarManualParceiro(corpo.manual_para));
    }

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
