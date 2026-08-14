# NutriFicha — Contexto do Projeto

Leia este arquivo antes de qualquer alteração. Ele resume decisões já tomadas para não
serem revertidas por engano numa sessão nova.

## O que é

Plataforma web para nutricionistas, do Gabriel. Começou como calculadora nutricional
simples e evoluiu para sistema de gestão de consultório (SaaS B2B, venda para
nutricionistas usarem em seus consultórios).

- **Nome:** NutriFicha
- **Referência de mercado:** WebDiet (webdiet.com.br) — **sem** a parte de cursos
- **Repositório:** github.com/contatogabriel73-art/calculadora-nutricional
- **Contato do rodapé:** contatogabriel73@gmail.com

## Stack e decisões técnicas (não reverter sem confirmar com o Gabriel)

| Item | Estado atual |
|---|---|
| Frontend | HTML/CSS/JS puro, sem framework, sem etapa de build |
| Base de dados nutricional | Tabela TACO (NEPA/UNICAMP, 4ª ed.) em `data/taco.json` |
| Persistência | Migrando de `localStorage` (por módulo: `pacientes-storage.js`, `agenda-storage.js`, `financeiro-storage.js`, `perfil-storage.js`, `avaliacoes-storage.js`) para **Supabase (Postgres)** |
| Login | Migrando de fictício (`js/auth.js`) para **Supabase Auth real**, com dois papéis de conta: nutricionista e paciente |
| Segurança do banco | Row Level Security em toda tabela, por `nutricionista_id`/`paciente_id` — obrigatório, não opcional |
| PWA | Sim — `manifest.json` + `sw.js` (stale-while-revalidate no shell, network-first no `taco.json`) |
| Identidade visual | Paleta VITABLOOM — verde-sálvia `#A8B5A0` (`--verde`) / `#5d6b56` (`--verde-escuro`, usado onde precisa de contraste) / `#F5F0E8` (`--verde-claro`, creme), rosé `#E8B4B8`/`#b06a70` como acento pontual; ícone de garfo e faca |
| Gráficos | Chart.js via CDN (única dependência externa) |

Os módulos de storage foram isolados de propósito (mesma assinatura de função em cada
um) para a migração ao Supabase ser troca de camada, sem reescrever as telas que os
chamam.

## Contas: dois papéis, um sistema só

No cadastro, o usuário escolhe **nutricionista** ou **paciente** (quem está sendo
avaliado por um nutricionista). Não são sites separados — é o mesmo sistema, com áreas
e navegação diferentes por papel:

- **Nutricionista:** painel completo — pacientes, agenda, financeiro, fichas técnicas, avaliações.
- **Paciente:** área enxuta, só leitura — próprias consultas, própria evolução (gráficos),
  próprio plano/ficha quando o nutricionista disponibilizar.

O paciente se vincula ao nutricionista por um código/convite gerado no cadastro do
paciente pelo nutricionista. O vínculo é opcional — um nutricionista deve continuar
funcionando normalmente com pacientes que nunca criam conta própria.

## O que já está construído

- Landing page de vendas (`index.html`) — hero, benefícios, seção "consultório", FAQ, rodapé
- Login demo (`login.html`) — em migração para Supabase Auth
- Cadastro e gestão de pacientes
- Ficha técnica de preparo + rótulo nutricional (abas Montar / Ficha Técnica / Rótulo) —
  calcula índice de correção, fator de cocção, peso bruto/líquido/final, custo por
  porção, valor per capita; rótulo no padrão RDC 429/2020 e IN 75/2020 (ANVISA)
- Agenda de consultas (`agenda.html`) — visão mês/semana, status, detecção de conflito
- Financeiro (`financeiro.html`) — lançamentos, pendências, recibo, dados do emitente
- Redesign: paleta VITABLOOM, sidebar fixa na área interna substituindo a barra de
  abas, e menu de perfil do nutricionista (foto via Supabase Storage + badge de
  plano de assinatura, sem cobrança — `perfil.html`)

## Anamnese e evolução — princípio estrutural (não violar)

O "antes e depois" depende de **como o dado é salvo**. A anamnese é separada em duas
naturezas:

- **Dado fixo** (registra uma vez, edita se mudar): histórico familiar, cirurgias,
  alergias, intolerâncias, restrições, medicação contínua. Fica no cadastro do paciente.
- **Dado evolutivo** (cada consulta cria um registro NOVO, datado — **nunca sobrescreve**):
  antropometria (peso, IMC, cintura, quadril), exames laboratoriais, hábitos numéricos,
  escalas subjetivas (0 a 10). Vive em `avaliacoes-storage.js`/tabela `avaliacoes`.

Só o dado evolutivo vira gráfico (peso, cintura, IMC com linha de meta sobreposta;
exames com faixa de referência sombreada). Campos de texto (queixa, relato,
observações) usam comparação lado a lado entre duas datas, não gráfico.

⚠️ **Fotos de evolução corporal: não implementar ainda.** `localStorage` tinha cota de
~5 MB (poucas fotos quebravam o app); mesmo com Supabase, foto corporal é dado sensível
de saúde e biométrico sob a LGPD e exige consentimento específico por escrito — tratar
como etapa própria, não incluir de passagem em outra fase.

## Avisos que devem ser mantidos

⚠️ **LGPD.** Dado de paciente é dado de saúde — categoria mais sensível da LGPD. O banco
de dados real com Row Level Security é o que torna aceitável guardar dado real de
paciente; enquanto a migração não estiver completa **e testada** (inclusive testando que
um paciente não vê dados de outro paciente), manter o aviso de protótipo na landing/FAQ.

⚠️ **O app não roda via `file://`** — precisa de servidor HTTP por causa do `fetch` do
`taco.json`. Testar com `python3 -m http.server 8000` na pasta do projeto.

## Roadmap

**Em andamento:** migração para Supabase (Auth real + Postgres com Row Level Security),
cadastro com escolha de papel, área do paciente, landing page explicando o painel para
os dois públicos, anamnese com registros datados e gráficos de evolução, gráficos do
financeiro, painel inicial pós-login, integração agenda ↔ financeiro, sidebar e modo
escuro na área interna.

**Depois:** prescrição de plano alimentar, diário alimentar, questionário pré-consulta,
pagamento, envio automático de e-mail/WhatsApp, integração com Google Agenda.

## Fase 4 — Conta de teste para o Gabriel

- Criar, via seed/script (não pela tela de cadastro normal, pra pular a verificação de
  CRN), uma conta de nutricionista de teste:
  - E-mail e senha fixos e simples, que você escolhe ao rodar o script.
  - `status_verificacao = 'verificado'` direto, sem passar pela Fase 2.
  - Marcar essa conta com uma flag clara (`conta_teste = true`), e/ou um comentário no
    script avisando: "Conta de teste — excluir antes do lançamento em produção."
- Essa mesma conta pode servir também de conta administradora pra aprovar os cadastros
  pendentes da Fase 2 (`papel_admin = true`).

(Isso já está parcialmente feito — usei `teste.nutri2@nutrificha.test` como admin de
teste pra validar a tela. A diferença é que essa aqui era só pra mim testar; a Fase 4
de verdade é criar a conta com o seu e-mail real, que você efetivamente vai usar.)

## Fase 5 — Landing: explicar os dois públicos, com um único caminho de cadastro

⚠️ Corrige um resquício do fluxo antigo: se `cadastro.html` ainda lesse `?papel=` da URL
pra alternar entre formulário de nutricionista e paciente (de uma versão anterior do
prompt), isso devia ser removido — hoje só existe um cadastro possível, o do
nutricionista.

- Reescrever a seção "Feito para o seu consultório" (ou criar uma nova) explicando que
  o NutriFicha serve tanto o nutricionista quanto o paciente dele, mas o acesso funciona
  diferente pra cada um:
  - O nutricionista cria a própria conta (botão "Começar agora" / "Sou nutricionista",
    único caminho de cadastro da landing) e organiza pacientes, agenda, fichas técnicas
    e evolução num só lugar.
  - O paciente não cria conta pela landing. Ele recebe o acesso automaticamente por
    e-mail quando o próprio nutricionista cadastra ele no sistema. Um parágrafo curto
    explicando isso, com chamada tipo "É paciente de um nutricionista que usa o
    NutriFicha? Peça pra ele liberar seu acesso" — sem botão, sem formulário, só
    orientação.
- `cadastro.html` passa a ter um único formulário (o do nutricionista), sem branch por
  papel.
- Manter o tom e a identidade visual da landing (direto, sem exagero, paleta VITABLOOM — ver "Stack e decisões técnicas").

## Como trabalhar neste projeto

- Implementar em **fases numeradas, uma de cada vez**. Ao fim de cada fase, parar, rodar
  o app e confirmar que nada quebrou antes de seguir. Não tentar implementar várias
  fases grandes numa tacada só — isso já gerou código incompleto antes neste projeto.
- Esta é uma etapa (migração de banco de dados) de risco maior que as anteriores —
  preferir commits pequenos e frequentes.
- Não migrar para framework nem adicionar etapa de build sem que o Gabriel peça
  explicitamente — o projeto é JS puro por decisão, não por falta de escolha.
