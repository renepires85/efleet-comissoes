# eFleet · Sistema de Comissões
## Documentação Técnica — v1.0

---

## 1. Visão Geral

O **Sistema de Comissões eFleet** automatiza o cálculo, validação e pagamento das comissões da equipe comercial (parceiros PJ).

**Como funciona na prática:**
1. Todo mês, a equipe de dados entrega um arquivo Excel com TPV e receita por cliente
2. O financeiro sobe esse arquivo no sistema
3. O sistema calcula automaticamente as comissões aplicando a Curva C de ramp-up
4. Cada parceiro recebe uma notificação por e-mail
5. O parceiro acessa o sistema, confere os valores e aprova até o dia 20
6. O financeiro confirma o pagamento e registra a data
7. O parceiro recebe confirmação do pagamento por e-mail

**Produtos comissionados:**
- **FUEL** — 20% da receita eFleet (take rate × TPV)
- **PASS, FINES, PREMIUM** — 7% da mensalidade mensal

---

## 2. Arquitetura do Sistema

O sistema usa 3 ferramentas, cada uma com um papel específico:

```
GitHub (código) → Vercel (hospedagem) → Browser (usuário)
                         ↕
                    Supabase (banco + autenticação + funções)
```

| Ferramenta | Função | URL/Link |
|---|---|---|
| **GitHub** | Armazena e versiona o código | github.com/renepires85/efleet-comissoes |
| **Vercel** | Publica o sistema na internet | efleet-comissoes.vercel.app |
| **Supabase** | Banco de dados, autenticação, Edge Functions | supabase.com (projeto: efleet-comissoes) |
| **Resend** | Envio de e-mails | resend.com |

### Fluxo de Deploy

```
Branch DEV (desenvolvimento)
    ↓ testa no preview do Vercel
Branch MAIN (produção)
    ↓ Vercel publica automaticamente
efleet-comissoes.vercel.app
```

**Regra de ouro:** nunca editar diretamente na branch `main`. Sempre desenvolver na branch `dev`, testar no preview, e só então mergear para `main`.

---

## 3. Banco de Dados (Supabase)

### Tabelas Principais

#### `usuarios`
Perfis de acesso ao sistema.
| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid | ID do usuário (mesmo do auth) |
| nome | text | Nome completo |
| perfil | text | `gestao`, `financeiro` ou `vendedor` |
| onboarding_step | int | Passo atual do onboarding (0-5) |
| onboarding_concluido | boolean | Se concluiu o primeiro acesso |
| aceite_politica_em | timestamptz | Data/hora do aceite da política |

#### `prestadores`
Parceiros comerciais cadastrados.
| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid | ID do prestador |
| codigo | text | Código gerado (ex: VND0001) |
| nome | text | Nome do parceiro |
| tipo | text | PJ ou PF |
| documento | text | CNPJ ou CPF |
| email | text | E-mail para notificações |
| cpf_responsavel | text | CPF do responsável (PJ) |
| telefone | text | WhatsApp |
| banco | text | Banco para pagamento |
| agencia | text | Agência |
| conta | text | Conta |
| tipo_conta | text | corrente, poupanca, pagamento |
| pix | text | Chave PIX |
| ativo | boolean | Se está ativo nas apurações |
| usuario_id | uuid | Referência ao usuário de acesso |

#### `uploads`
Histórico de arquivos enviados.
| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid | ID do upload |
| nome_arquivo | text | Nome do arquivo Excel |
| periodo_inicio | date | Início do período (ex: 2026-05-01) |
| periodo_fim | date | Fim do período (ex: 2026-05-31) |
| total_linhas | int | Número de linhas do arquivo |
| status | text | `processando` ou `concluido` |
| linhas_ok | int | Linhas calculadas com sucesso |
| uploader_id | uuid | Usuário que fez o upload |
| criado_em | timestamptz | Data/hora do upload |

#### `fechamentos`
Linhas individuais de cada arquivo enviado.
| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid | ID da linha |
| upload_id | uuid | Referência ao upload |
| vendedor_nome | text | Nome do parceiro (deve bater com `prestadores.nome`) |
| cliente_cnpj | text | CNPJ do cliente |
| cliente_nome | text | Nome do cliente |
| ativacao_fuel | date | Data de ativação do FUEL |
| ativacao_pass | date | Data de ativação do PASS |
| ativacao_fines | date | Data de ativação do FINES |
| ativacao_premium | date | Data de ativação do PREMIUM |
| receita_fuel | numeric | Receita FUEL do mês |
| receita_pass | numeric | Receita PASS do mês |
| receita_fines | numeric | Receita FINES do mês |
| receita_premium | numeric | Receita PREMIUM do mês |
| status_cliente | text | `ativo`, `inadimplente` ou `churn` |

#### `comissoes`
Comissões calculadas por produto e cliente.
| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid | ID da comissão |
| fechamento_id | uuid | Referência ao fechamento |
| prestador_id | uuid | Referência ao prestador |
| produto | text | FUEL, PASS, FINES ou PREMIUM |
| data_ativacao | date | Data de ativação do produto |
| mes_curva | int | Mês na curva C (1 a 12) |
| fator_ramp | numeric | Fator de ramp-up (0.2 a 1.0) |
| base_calculo | numeric | Valor base para cálculo |
| taxa_comissao | numeric | Taxa aplicada (0.20 ou 0.07) |
| comissao_bruta | numeric | Valor da comissão |
| status | text | `calculada`, `suspensa` ou `zerada` |

#### `validacoes_mensais`
Registro de validação por parceiro por período.
| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid | ID da validação |
| prestador_id | uuid | Referência ao prestador |
| periodo_inicio | date | Início do período |
| periodo_fim | date | Fim do período |
| status | text | `pendente`, `aprovado`, `contestado` ou `pago` |
| aprovado_em | timestamptz | Data/hora da aprovação |
| pago_em | timestamptz | Data/hora do pagamento |
| pago_por | uuid | Usuário que confirmou o pagamento |
| observacao | text | Motivo da contestação ou obs do pagamento |
| upload_id | uuid | Referência ao upload |

#### `checkpoints`
Histórico de cálculos realizados.
| Coluna | Tipo | Descrição |
|---|---|---|
| id | uuid | ID do checkpoint |
| upload_id | uuid | Referência ao upload |
| total_linhas | int | Total de linhas processadas |
| calculadas | int | Linhas calculadas com sucesso |
| nao_calculadas | int | Linhas com erro |
| detalhes | jsonb | Detalhamento linha a linha |
| criado_por | uuid | Usuário que rodou o cálculo |

### Views (Consultas Prontas)

| View | Descrição |
|---|---|
| `vw_resumo_prestador` | Resumo de comissões por parceiro e período |
| `vw_extrato_prestador` | Extrato detalhado por parceiro |
| `vw_acumulado_prestador` | Total acumulado histórico por parceiro |

### Funções SQL

| Função | Descrição |
|---|---|
| `processar_comissoes(p_upload_id)` | Calcula comissões de um upload. Roda com `SECURITY DEFINER` para bypassar RLS |
| `criar_validacoes_pendentes(p_upload_id)` | Cria registros de validação pendente por parceiro |
| `calcular_mes_curva(p_ativacao, p_periodo_fim)` | Calcula o mês na curva C |
| `calcular_fator_ramp(p_mes_curva)` | Retorna o fator de ramp-up para o mês |
| `gerar_codigo_prestador(p_nome)` | Gera código sequencial (VND0001, VND0002...) |

---

## 4. Edge Functions (Supabase)

Funções que rodam no servidor, chamadas pelo frontend via HTTP.

### `smart-service`
**Propósito:** Enviar convite de acesso para novos usuários.

**Como funciona:**
1. Recebe `nome`, `email` e `perfil`
2. Usa `auth.admin.inviteUserByEmail()` para criar o usuário no Supabase
3. Insere o registro na tabela `usuarios` com o perfil correto
4. Supabase envia o e-mail de convite automaticamente

**Parâmetros:**
```json
{ "nome": "João Silva", "email": "joao@empresa.com", "perfil": "vendedor" }
```

### `clever-handler`
**Propósito:** Enviar notificações por e-mail via Resend.

**Como funciona:**
1. Recebe `prestador_id`, `periodo` e `tipo`
2. Busca o e-mail do prestador no banco
3. Envia e-mail via API do Resend

**Parâmetros:**
```json
{ "prestador_id": "uuid", "periodo": "maio de 2026", "tipo": "validacao" }
```

**Tipos de notificação:**
- `validacao` — comissões prontas para aprovação
- `pago` — pagamento confirmado

**Configuração necessária:**
- Secret `RESEND_API_KEY` configurado em Edge Functions → Secrets

---

## 5. Frontend (index.html)

Todo o sistema está em um único arquivo `index.html` na raiz do repositório.

### Estrutura do Arquivo

```
index.html
├── <style>          → CSS com Design System eFleet v4.0
├── #login-screen    → Tela de login
├── #onboarding-screen → Fluxo de primeiro acesso (6 telas)
├── #app             → Aplicação principal
│   ├── .topbar      → Barra superior com logo e usuário
│   ├── #nav-tabs    → Abas de navegação (gestão/financeiro)
│   └── .main        → Conteúdo principal
│       ├── #view-gestao    → Dashboard gestão/financeiro
│       ├── #view-vendedor  → Extrato do parceiro
│       ├── #view-arquivos  → Upload e histórico
│       ├── #view-checkpoints → Histórico de cálculos
│       └── #view-prestadores → Cadastro de parceiros
├── Modais           → Prestador, Convite, Contestar, Pagamento
└── <script>         → JavaScript (dividido em 4 blocos)
```

### Perfis de Acesso

| Perfil | O que vê | O que pode fazer |
|---|---|---|
| `gestao` | Tudo | Upload, cálculo, prestadores, convites, confirmar pagamento |
| `financeiro` | Igual à gestão, sem aba Prestadores | Upload, cálculo, confirmar pagamento |
| `vendedor` | Só o próprio extrato | Aprovar, contestar, atualizar dados bancários |

### Bibliotecas Usadas

| Biblioteca | Versão | Uso |
|---|---|---|
| `@supabase/supabase-js` | v2 | Conexão com banco e autenticação |
| `xlsx` | 0.18.5 | Leitura de Excel e exportação |

### Design System

O sistema usa o **eFleet Design System v4.0**:
- **Cor primária:** Navy `#245091`
- **Cor acento:** Green `#A4C557`
- **Tipografia heading:** Montserrat
- **Tipografia body:** Nunito
- **Fundo:** `#0B1929`

---

## 6. Fluxos Principais

### 6.1 Upload e Cálculo de Comissões

```
Financeiro sobe arquivo Excel
    ↓
Sistema lê o arquivo (aba FECHAMENTO_MES)
    ↓
Salva na tabela uploads
    ↓
Salva linhas na tabela fechamentos
    ↓
Chama RPC processar_comissoes
    ↓
Comissões salvas na tabela comissoes
    ↓
Cria registros em validacoes_mensais (status: pendente)
    ↓
Dashboard atualiza automaticamente
```

**Atenção:** Se a RPC falhar (ex: timeout), o arquivo fica como "Pendente" na aba Arquivos. Nesse caso, clicar em "▶ Calcular" ou "▶ Rodar cálculo" resolve.

### 6.2 Validação pelo Parceiro

```
Parceiro recebe e-mail de notificação
    ↓
Acessa o sistema e confere o extrato
    ↓
Clica "✓ Aprovar" → status: aprovado
    ou
Clica "✗ Contestar" → preenche motivo → status: contestado
```

### 6.3 Confirmação de Pagamento

```
Gestão vê validação com status "aprovado"
    ↓
Clica "💰 Pagar" na aba Validações
    ↓
Informa a data do pagamento
    ↓
Status muda para "pago"
    ↓
Parceiro recebe e-mail de confirmação
```

### 6.4 Primeiro Acesso (Onboarding)

```
Gestão convida parceiro via sistema (aba Prestadores)
    ↓
Supabase envia e-mail com link
    ↓
Parceiro clica no link → vai para o sistema
    ↓
Sistema detecta token de convite na URL
    ↓
Inicia fluxo de onboarding (6 telas):
    1. Boas-vindas
    2. Dados pessoais (nome, CPF, telefone)
    3. Dados bancários (opcional, pode pular)
    4. Aceite da política de comissões
    5. Criar senha
    6. Tutorial do sistema
    ↓
Parceiro entra no dashboard com extrato
```

**Retomada:** Se o parceiro fechar o browser no meio, ao voltar o sistema retoma do passo onde parou (campo `onboarding_step` na tabela `usuarios`).

---

## 7. Regras de Negócio

### 7.1 Curva C (Ramp-up)

A comissão não é paga integralmente desde o início. Ela cresce ao longo de 12 meses:

| Mês na curva | Fator | % da comissão paga |
|---|---|---|
| Mês 1 | 0.20 | 20% |
| Mês 2 | 0.40 | 40% |
| Mês 3 | 0.60 | 60% |
| Meses 4, 5, 6 | 0.80 | 80% |
| Meses 7 a 12 | 1.00 | 100% |
| Após mês 12 | 0.00 | Comissão encerrada |

**Como o mês é calculado:** a partir da data de ativação do produto até o último dia do período apurado.

### 7.2 Taxas de Comissão

| Produto | Base de cálculo | Taxa |
|---|---|---|
| FUEL | Receita eFleet (take rate × TPV) | 20% |
| PASS | Mensalidade mensal | 7% |
| FINES | Mensalidade mensal | 7% |
| PREMIUM | Mensalidade mensal | 7% |

**Fórmula:** `Comissão = Receita × Taxa × Fator_Ramp`

### 7.3 Status do Cliente

| Status | Efeito na comissão |
|---|---|
| `ativo` | Comissão calculada normalmente |
| `inadimplente` | Comissão suspensa (aparece zerada, mas é mantida no registro) |
| `churn` | Comissão zerada (cliente saiu) |

### 7.4 Ciclo de Pagamento

- **Apuração:** mês M (ex: abril)
- **Validação pelo parceiro:** até dia 20 do mês M+1 (ex: até 20/maio)
- **Pagamento:** mês M+2 (ex: junho)
- **NF:** emitida pelo parceiro após aprovação

---

## 8. Formato do Arquivo Excel

O arquivo de fechamento deve ter uma aba chamada `FECHAMENTO_MES` com as seguintes colunas:

| Coluna | Obrigatório | Formato | Exemplo |
|---|---|---|---|
| periodo_inicio | Sim | YYYY-MM-DD | 2026-05-01 |
| periodo_fim | Sim | YYYY-MM-DD | 2026-05-31 |
| vendedor_nome | Sim | Texto | João Silva |
| cliente_cnpj | Sim | Texto | 11.111.111/0001-11 |
| cliente_nome | Sim | Texto | Transportes ABC |
| ativacao_fuel | Não | YYYY-MM-DD | 2025-07-01 |
| ativacao_pass | Não | YYYY-MM-DD | 2025-09-01 |
| ativacao_fines | Não | YYYY-MM-DD | |
| ativacao_premium | Não | YYYY-MM-DD | |
| tpv_fuel | Não | Número | 370000 |
| receita_fuel | Não | Número | 5550 |
| receita_pass | Não | Número | 700 |
| receita_fines | Não | Número | |
| receita_premium | Não | Número | |
| status_cliente | Sim | ativo/inadimplente/churn | ativo |

**Atenção:** O campo `vendedor_nome` deve ser idêntico ao nome cadastrado na tabela `prestadores`. Qualquer diferença (espaço extra, acento errado) faz o sistema não encontrar o parceiro e gerar erro.

---

## 9. Guia de Manutenção

### Onde encontrar cada coisa no código

| O que | Onde no index.html |
|---|---|
| Configuração do Supabase (URL e chave) | Início do primeiro `<script>`, função `createClient` |
| Botão de login | HTML linha ~154, id `login-btn` |
| Lógica de login | Função `doLogin()` |
| Detecção de convite/onboarding | Dentro do `DOMContentLoaded`, após `getSession()` |
| Fluxo de onboarding (6 telas) | Função `renderObStep()` |
| Carregamento do dashboard | Função `carregarGestao()` |
| Cálculo de comissões (frontend) | Função `calcularCheckpoint()` |
| Upload de arquivo | Função `processarUpload()` |
| Extrato do parceiro | Função `carregarVendedor()` |
| Aprovação de comissão | Função `aprovarComissoes()` |
| Confirmação de pagamento | Função `confirmarPagamento()` |
| Envio de e-mail de notificação | Função `notificarEmail()` |
| Exportação Excel (relatório) | Função `exportarRelatorio()` |
| Exportação PDF (extrato) | Função `exportarExtratoPDF()` |
| Filtro de período | Funções `getPeriodoDates()` e `setPeriodo()` |
| Navegação entre abas | Função `switchNav()` |
| Formatação de moeda | Função `fmtR()` |
| Formatação de período | Função `formatPeriodo()` |

### Alterações Comuns

**Mudar a taxa de comissão do FUEL (de 20% para outro valor):**
- No banco: função `processar_comissoes` — linha `v_comissao := rec.receita_fuel * 0.20 * v_fator_ramp`
- No frontend: função `calcularCheckpoint()` — linha `{produto:'FUEL',...,taxa:0.20}`

**Mudar a Curva C:**
- No banco: função `calcular_fator_ramp`
- No frontend: função `calcularCheckpoint()`, bloco de cálculo do fator

**Mudar o e-mail remetente das notificações:**
- Edge Function `clever-handler` — campo `from`

**Mudar a URL do sistema (ex: domínio próprio):**
- Edge Function `smart-service` — campo `redirectTo`
- Supabase → Authentication → URL Configuration → Site URL e Redirect URLs
- Edge Function `clever-handler` — link no corpo do e-mail

**Adicionar novo produto (ex: RAV):**
1. Adicionar colunas `ativacao_rav` e `receita_rav` na tabela `fechamentos`
2. Adicionar bloco de cálculo na função SQL `processar_comissoes`
3. Adicionar bloco de cálculo na função `calcularCheckpoint()` no frontend
4. Adicionar colunas no arquivo Excel modelo

### Erros Comuns e Soluções

| Erro | Causa | Solução |
|---|---|---|
| `new row violates row-level security policy` | RPC sendo chamada sem permissão de INSERT | A função `processar_comissoes` deve ter `SECURITY DEFINER` |
| `Prestador não encontrado` | Nome no Excel diferente do cadastro | Verificar espaços, acentos e maiúsculas no campo `vendedor_nome` |
| `email rate limit exceeded` | Muitos convites enviados para o mesmo e-mail | Aguardar 15 minutos e tentar com e-mail diferente |
| Dashboard zerado | RPC não rodou após upload | Clicar em "▶ Rodar cálculo" ou calcular na aba Arquivos |
| Onboarding não abre no convite | Token de convite não detectado na URL | Verificar se `redirectTo` na Edge Function aponta para o domínio correto |
| `Load failed` na notificação | Timeout da Edge Function | A função pode estar em cold start — tentar novamente |

---

## 10. Glossário

### Termos de Negócio

**TPV (Total de Pagamentos em Volume)**
Volume total de pagamentos processados por um cliente no período. Base para calcular a receita do FUEL.

**Take Rate**
Percentual que a eFleet retém sobre o TPV. Ex: se o TPV é R$100.000 e o take rate é 1,5%, a receita é R$1.500.

**Curva C (Ramp-up)**
Escalonamento progressivo da comissão ao longo de 12 meses. Um cliente novo gera menos comissão nos primeiros meses, chegando a 100% apenas no mês 7.

**Janela de Comissão**
Período de 12 meses durante o qual o parceiro recebe comissão por um cliente. Após o mês 12, a comissão é encerrada automaticamente.

**Fator Ramp**
Multiplicador aplicado à comissão bruta baseado no mês da curva. Vai de 0.20 (20%) no mês 1 até 1.00 (100%) do mês 7 em diante.

**Mês Curva**
Número do mês do cliente na curva C, calculado a partir da data de ativação do produto.

**Comissão Suspensa**
Comissão calculada mas não paga por inadimplência do cliente. É mantida no registro mas não entra no total a pagar.

**Comissão Zerada**
Comissão de um cliente em churn. É registrada com valor zero.

**Parceiro / Prestador**
Comercial externo que vende os produtos eFleet e recebe comissão. Sempre PJ (pessoa jurídica). No banco chamado de `prestador`.

**Apuração**
Processo mensal de cálculo das comissões com base no arquivo de fechamento.

**Fechamento**
Arquivo Excel entregue pela equipe de dados com os dados de TPV e receita do mês.

**Validação**
Processo pelo qual o parceiro confere e aprova os valores calculados antes do pagamento.

**Checkpoint**
Registro histórico de um cálculo realizado, com o resultado linha a linha.

### Termos Técnicos

**Supabase**
Plataforma de banco de dados PostgreSQL como serviço. Usado para armazenar todos os dados, autenticar usuários e rodar funções serverless.

**Edge Function**
Função que roda no servidor do Supabase, chamada pelo frontend via HTTP. Usada para operações que requerem chaves secretas (como enviar e-mails).

**RPC (Remote Procedure Call)**
Chamada de função SQL diretamente pelo frontend via Supabase. Ex: `sb.rpc('processar_comissoes', {p_upload_id: uid})`.

**RLS (Row Level Security)**
Sistema de segurança do Supabase que controla quais linhas cada usuário pode ler/escrever. As políticas definem as regras por tabela.

**SECURITY DEFINER**
Modificador de função SQL que faz a função rodar com permissões do criador (admin), bypassando o RLS. Necessário para funções que fazem INSERT em tabelas com RLS restritivo.

**Branch**
Versão paralela do código no GitHub. `main` é a produção. `dev` é onde se desenvolve antes de publicar.

**Merge**
Ação de juntar as alterações da branch `dev` na branch `main`, colocando em produção.

**Vercel**
Plataforma de hospedagem que lê o GitHub e publica o sistema automaticamente a cada commit na `main`.

**Preview (Vercel)**
Link de teste gerado automaticamente pelo Vercel para cada branch ou Pull Request. Permite testar antes de publicar em produção.

**Resend**
Serviço de envio de e-mails transacionais. Usado para notificações de comissão e pagamento.

---

## 11. Pendências e Próximos Passos

### Pendentes de Implementação

- [ ] **Notificação automática no upload** — hoje é manual (botão Notificar). Deve disparar automaticamente ao processar o arquivo
- [ ] **Cron diário de cobrança** — Edge Function agendada que envia lembrete todo dia de manhã para validações pendentes há mais de 24h
- [ ] **PDF da política de comissões** — placeholder está no onboarding, PDF ainda não foi gerado
- [ ] **Domínio próprio** — hoje usa `efleet-comissoes.vercel.app`, idealmente migrar para `comissoes.efleet.digital`
- [ ] **E-mail remetente próprio** — hoje usa `onboarding@resend.dev`, idealmente `comissoes@efleet.digital`

### Melhorias Identificadas

- [ ] Validação do arquivo Excel antes de salvar (colunas obrigatórias, formatos de data)
- [ ] Paginação nas tabelas de clientes e histórico
- [ ] Filtro por parceiro na aba Checkpoints
- [ ] Histórico de alterações de dados bancários
- [ ] Relatório de comissões por produto (não só por parceiro)

---

## 12. Informações de Acesso

> ⚠️ **Atenção:** Nunca compartilhar as chaves abaixo em ambientes públicos.

| Serviço | Onde gerenciar |
|---|---|
| Supabase | supabase.com → Projeto efleet-comissoes |
| GitHub | github.com/renepires85/efleet-comissoes |
| Vercel | vercel.com → Projeto efleet-comissoes |
| Resend | resend.com → API Keys |

**Chaves necessárias para o sistema funcionar:**
- `SUPABASE_URL` — URL do projeto Supabase (automática nas Edge Functions)
- `SUPABASE_SERVICE_ROLE_KEY` — Chave de serviço (automática nas Edge Functions)
- `RESEND_API_KEY` — Configurada em Edge Functions → Secrets

---

*Documentação gerada em maio de 2026 · eFleet Digital*
