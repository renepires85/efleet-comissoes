// ── CONFIGURAÇÃO GLOBAL ───────────────────────────────────────────────────────
const SUPABASE_URL = 'https://zakxroemofwolqqkfyaz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha3hyb2Vtb2Z3b2xxcWtmeWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0OTA4NTMsImV4cCI6MjA5MzA2Njg1M30.U2R5R2YUDY0kIPXTgtqmNDfFjxm3EqSSVcj3hLj-bC0';
const CLEVER_URL   = SUPABASE_URL + '/functions/v1/clever-handler';
const SMART_URL    = SUPABASE_URL + '/functions/v1/smart-service';

// ── ERRO VINDO NA URL ─────────────────────────────────────────────────────────
// Lido ANTES de criar o cliente: o supabase-js limpa o hash ao processá-lo, e
// depois disso não há mais como saber que a pessoa chegou aqui por um link que
// falhou. Sem isso ela caía numa tela de login idêntica à normal, sem uma
// palavra de explicação — e tentava de novo, e de novo.
const erroNaUrl = (() => {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const cod = h.get('error_code');
  if (!cod) return null;
  return cod === 'otp_expired'
    ? 'Este link já não vale — links de e-mail valem uma vez só, e alguns servidores de e-mail os abrem antes de você. Peça um código novo em "Esqueci minha senha": o código não tem esse problema.'
    : (h.get('error_description') || 'O link não pôde ser usado.').replace(/\+/g, ' ');
})();

// ── CLIENTE SUPABASE ──────────────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// Link de recuperação de senha.
// O link do e-mail cria uma sessão válida — sem tratar isso, a pessoa entraria
// direto no sistema e NUNCA definiria a senha nova, que é o motivo de ela ter
// clicado. O evento pode chegar antes ou depois do init da página, então o
// marcador fica aqui (registrado antes de tudo) e o init consulta depois.
let recuperacaoDeSenha = false;
sb.auth.onAuthStateChange((evento) => {
  if (evento !== 'PASSWORD_RECOVERY') return;
  recuperacaoDeSenha = true;
  if (typeof entrarModoRecuperacao === 'function') entrarModoRecuperacao();
});

// ── ESTADO GLOBAL ─────────────────────────────────────────────────────────────
let currentUser        = null;
let currentPerfil      = null;
let currentPrestadorId = null;
let currentValidacaoId = null;
let currentPagamentoId = null;
let periodoAtual       = 'ultimo_mes';
