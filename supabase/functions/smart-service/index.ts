import { createClient } from "jsr:@supabase/supabase-js@2";

export default async (req: Request) => {
  console.log("smart-service iniciado");

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  let body: {
    nome?: string;
    email?: string;
    perfil?: string;
    senha?: string;
  } = {};

  try {
    body = await req.json();
    console.log("body recebido:", JSON.stringify(body));
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }

  const { nome, email, perfil, senha } = body;

  if (!nome || !email || !perfil || !senha) {
    return Response.json({ error: "nome, email, perfil e senha são obrigatórios" }, { status: 400 });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Criar usuário no Auth
    console.log("criando usuário no Auth:", email);
    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
    });

    if (authError || !authData?.user) {
      console.log("erro ao criar usuário no Auth:", authError?.message);
      return Response.json({ error: authError?.message ?? "Erro ao criar usuário" }, { status: 400 });
    }

    const userId = authData.user.id;
    console.log("usuário criado no Auth, id:", userId);

    // 2. Inserir na tabela usuarios
    const perfilDB = perfil === "gestao" ? "gestao" : "vendedor";
    const { error: usuarioError } = await sb.from("usuarios").insert({
      id: userId,
      nome,
      perfil: perfilDB,
      ativo: true,
    });

    if (usuarioError) {
      console.log("erro ao inserir em usuarios:", usuarioError.message);
      return Response.json({ error: "Erro ao criar perfil do usuário: " + usuarioError.message }, { status: 500 });
    }

    console.log("usuário inserido em usuarios");

    // 3. Se vendedor, inserir em prestadores
    if (perfilDB === "vendedor") {
      const now = new Date().toISOString();
      const { error: prestadorError } = await sb.from("prestadores").insert({
        nome,
        email,
        tipo: "PJ",
        ativo: true,
        usuario_id: userId,
        criado_em: now,
        atualizado_em: now,
      });

      if (prestadorError) {
        console.log("erro ao inserir em prestadores:", prestadorError.message);
        return Response.json({ error: "Erro ao criar prestador: " + prestadorError.message }, { status: 500 });
      }

      console.log("prestador inserido em prestadores");
    }

    return Response.json({ ok: true, user_id: userId });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("erro interno:", msg);
    return Response.json({ error: msg }, { status: 500 });
  }
};
