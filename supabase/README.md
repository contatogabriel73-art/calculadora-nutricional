# Banco de dados (Supabase)

> **Status:** já feito no projeto `CALCULADORA1`
> (`wxezmcabuuiwixsvkwum`) — as 9 tabelas estão criadas, a RLS está barrando
> acesso anônimo, a função de vínculo por código de convite (`resgatar_convite`)
> está no ar e testada, e a Edge Function de verificação de CRN
> (`verificar-crn`) está publicada e testada nos quatro caminhos possíveis.
> Este guia fica para quem for montar outro ambiente, ou para repetir se
> algo se perder.

Passo a passo para deixar o banco de pé. São uns dez minutos, feitos uma vez só.

## 1. Criar o projeto

1. Entre em [supabase.com](https://supabase.com) e crie uma conta (o plano gratuito serve).
2. **New project**. Escolha um nome (ex.: `nutrificha`), defina a senha do banco —
   **guarde essa senha**, ela não aparece de novo — e escolha a região
   **South America (São Paulo)**: os dados são de pacientes brasileiros e a
   latência de qualquer consulta cai bastante.
3. Espere o projeto terminar de subir (uns dois minutos).

## 2. Criar as tabelas

1. No menu lateral: **SQL Editor** → **New query**.
2. Cole o conteúdo inteiro de [`schema.sql`](schema.sql) e clique em **Run**.
3. No fim ele imprime uma tabela de conferência. Confira que aparecem **9 linhas**,
   todas com `rls_ligada = true` e `politicas` maior que zero:

   | tabela | rls_ligada | politicas |
   |---|---|---|
   | anamneses | true | 1 |
   | avaliacoes | true | 2 |
   | consultas | true | 2 |
   | fichas_tecnicas | true | 2 |
   | metas | true | 2 |
   | pacientes | true | 2 |
   | pagamentos | true | 1 |
   | perfis | true | 2 |
   | planos | true | 2 |

   Qualquer `false` ou `0` significa dado exposto — não siga em frente sem resolver.

O arquivo pode ser rodado de novo quantas vezes precisar: ele não duplica tabela
nem apaga dado.

Duas coisas que atrapalham nessa tela:

- **Desligue a tradução automática do Chrome** antes de usar o SQL Editor. Com a
  página traduzida, o painel quebra com um erro de tela branca
  (`Failed to execute 'removeChild' on 'Node'`) — o próprio Supabase avisa
  disso. A consulta chega a rodar, mas você não vê o resultado. Clique com o
  botão direito na página → **Mostrar sempre em inglês**.
- O painel avisa **"esta consulta inclui operações destrutivas"**. É por causa
  dos `drop trigger if exists` e `drop policy if exists`, que existem para o
  arquivo poder rodar de novo. Eles só removem objetos que o próprio arquivo
  recria em seguida — nenhuma tabela e nenhum dado.

## 3. Ligar o site ao projeto

1. No Supabase: **Project Settings** → **API**.
2. Copie **Project URL** e a chave **`anon` / `public`**.
3. Cole os dois em [`../js/supabase-config.js`](../js/supabase-config.js).

⚠️ Só a chave `anon`. A `service_role` (ou `secret`) **ignora Row Level Security** —
se ela for parar nesse arquivo, o banco inteiro fica aberto para qualquer visitante
do site, porque esse arquivo é baixado pelo navegador de quem acessa.

Não tem problema a chave `anon` ficar visível no código e no GitHub: ela foi feita
para isso. Quem protege os dados é a Row Level Security, não o sigilo da chave.

## 4. Conferir

Suba o servidor local e abra a página de conferência:

```bash
node server.js --sem-cache
```

Depois acesse `http://localhost:8080/supabase-teste.html`. Os três blocos precisam
passar: configuração preenchida, as 9 tabelas respondendo, e — sem estar logado —
nenhuma tabela devolvendo dados.

## 5. E-mail de confirmação

Por padrão o Supabase exige confirmação de e-mail no cadastro, e o serviço de
e-mail embutido tem limite baixo (poucas mensagens por hora), o que atrapalha
enquanto se testa.

**No projeto `CALCULADORA1` está LIGADO**, em
**Authentication → Sign In / Providers → Confirm email**. Foi ligado quando o
site foi publicado: sem confirmação, qualquer pessoa cria conta com o e-mail de
outra — e aqui a conta dá acesso a prontuário.

Consequência prática: **cada conta nova precisa clicar no link do e-mail antes
de conseguir entrar**, e o remetente embutido do Supabase tem cota baixa. Ao
criar várias contas seguidas você vai esbarrar em
`over_email_send_rate_limit` — não é erro do site, é a cota.

Se precisar testar em série, as saídas são:

- desligar **Confirm email** temporariamente, e **ligar de volta ao terminar**;
- ou confirmar a conta na mão em **Authentication → Users**, no menu de três
  pontos da linha;
- ou configurar um SMTP próprio em **Project Settings → Authentication → SMTP**,
  que é o caminho definitivo para uso real.

Reparo feito testando: com **Confirm email ligado**, cadastrar um e-mail em
domínio que não existe de verdade (como `@nutrificha.test`) devolve
`email_address_invalid` — o Supabase passa a validar se dá para entregar a
mensagem, coisa que não faz quando a confirmação está desligada. Isso é
esperado, não bug: com confirmação ligada, use um e-mail que exista de
verdade (ou um alias `+algumacoisa@` do seu próprio e-mail) para testar
cadastro pela tela.

## 6. Publicar a Edge Function de verificação de CRN

O código fica em [`functions/verificar-crn/index.ts`](functions/verificar-crn/index.ts).
Não precisa da Supabase CLI: o painel tem um editor que publica direto do
navegador.

1. No painel: **Edge Functions → Deploy a new function → Via Editor**.
2. Cole o conteúdo de `functions/verificar-crn/index.ts`.
3. Nome da função: `verificar-crn` (o código depende desse nome — é o que
   `js/auth.js` chama em `Auth.tentarVerificarCrn()`).
4. **Deploy**. A URL fica em
   `https://<projeto>.supabase.co/functions/v1/verificar-crn`.
5. Deixe **"Verify JWT"** ligado (padrão) — a função exige um token de
   sessão válido; sem isso, qualquer um poderia chamar em nome de qualquer
   conta.

Nenhum segredo extra para configurar: a função lê `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` do ambiente, que o Supabase já injeta sozinho em
toda Edge Function do projeto.

⚠️ **Cuidado com a tradução automática do Chrome neste editor também** —
mesmo problema do SQL Editor (ver seção 2). Depois de colar o código,
confira o conteúdo real do editor antes de publicar: a tela pode mostrar
texto traduzido (`deixe` no lugar de `let`, `tentar` no lugar de `try`), mas
isso é só exibição — o que é salvo é o conteúdo real, não o que apareceu
traduzido na tela. Ainda assim, desligar a tradução evita a confusão.

---

## Cadastro de nutricionista: CPF, CRN e verificação

O cadastro público (`cadastro.html`) só cria conta de nutricionista — não
existe mais escolha de papel na tela. Além de nome/e-mail/senha, pede CPF
(validado por dígito verificador, sem consultar nenhuma base externa — ver
`js/cpf.js`), CRN e endereço (preenchido por CEP via ViaCEP, ver `js/cep.js`).

Toda conta nova de nutricionista nasce com `status_verificacao = 'pendente'`.
Isso ainda não bloqueia nada no site — o gate de login que vai checar esse
campo é uma fase futura (verificação automática de CRN + aprovação manual).

### Armadilha: minha própria trava bloqueou o SQL Editor

`status_verificacao`, `papel`, `papel_admin` e `conta_teste` são protegidos
por um trigger (`proteger_campos_privilegiados`) que reverte qualquer
tentativa de mudança feita por quem não é admin — testado tentando se
autopromover pela API e conferindo que o banco devolve o valor antigo, não
o que foi mandado.

A trava original checava `auth.uid()`, que só existe numa requisição vinda
do PostgREST (a API). Rodar um `update` de manutenção pelo **SQL Editor**
conecta como `postgres`, sem JWT nenhum — `auth.uid()` vem nulo, e a
trava original teria revertido a própria correção administrativa. Corrigido
liberando `session_user = 'postgres'` no trigger: é um contexto mais
privilegiado que a trava tenta conter, não uma brecha — PostgREST nunca
assume esse papel para pedido de cliente (usa `anon` ou `authenticated`).

## Como o acesso está desenhado

Duas formas de entrar nos dados, e nenhuma outra:

- **Nutricionista** — faz tudo (ler, criar, editar, apagar) nas linhas em que
  `nutricionista_id` é o `auth.uid()` dele.
- **Paciente** — **só leitura**, e só nas linhas cuja ficha (`pacientes`) tem
  `usuario_id` igual ao `auth.uid()` dele.

O que o paciente enxerga: as próprias consultas, as próprias avaliações
(o gráfico de evolução), as próprias metas, e as fichas e planos que o
nutricionista marcou como `visivel_paciente`.

O que ele **não** enxerga: o financeiro e a anamnese. O financeiro é a
contabilidade do consultório; a anamnese tem anotação clínica escrita para o
profissional. Se um dia fizer sentido abrir, que seja uma decisão tomada de
propósito — não de passagem.

Um paciente nunca vê dados de outro paciente, nem do mesmo nutricionista: a
política filtra pelo `usuario_id` da ficha, não pelo nutricionista.

A ficha do paciente existe sem conta nenhuma (`usuario_id` nulo). Isso é
proposital — nem todo paciente vai querer login, e o nutricionista precisa
continuar trabalhando normalmente com esses.

### O vínculo (código de convite)

O nutricionista gera um código na ficha do paciente (botão "Gerar código de
convite", na aba Resumo) e passa por fora do sistema. O paciente digita esse
código na área dele.

Por baixo, isso é a função `resgatar_convite` em `schema.sql` — não dá para
fazer isso com um `update` comum do navegador, porque um paciente sem vínculo
não enxerga NENHUMA linha de `pacientes`: não teria como encontrar a ficha
pelo código para gravar o próprio `usuario_id` nela. A função roda com
privilégio elevado (`security definer`) só para essa operação específica, com
`search_path` fixo (obrigatório nesse tipo de função, senão dá para sequestrar
os nomes de tabela) e liberada só para `authenticated` — anônimo nem tenta.

Duas proteções que valem saber:

- **Código de uso único.** Ao ser resgatado, `codigo_convite` volta a `null`
  na mesma operação. Quem receber o código encaminhado depois de usado não
  entra em nada.
- **Uma conta de paciente vincula a UMA ficha só.** Sem esse check, nada
  impediria a mesma conta resgatar um segundo código e apontar para duas
  fichas ao mesmo tempo — e a área do paciente, que assume um vínculo só,
  não saberia qual mostrar.

Testado com duas contas de paciente reais: cada uma só vê a evolução, as
consultas e as fichas/planos liberados da própria ficha — inclusive tentando
acessar pelo id da ficha do outro paciente diretamente, não só pela tela.

### Verificação de CRN (Edge Function `verificar-crn`)

Consulta a **Consulta Nacional de Nutricionistas** do CFN
(`https://cnn.cfn.org.br/application/index/consulta-nacional`) — não é uma
API documentada, é uma tela pública que devolve JSON. Descoberta investigando
o tráfego de rede da própria página: o endpoint real é

```
POST https://cnn.cfn.org.br/application/front-resource/get
{ "comando": "get-nutricionista", "options": { "crn": "3", "registro": "62048", "geral": true } }
```

`crn` é a região do conselho (1 a 11 — o Brasil é dividido em 11 CRNs
regionais, não um por estado), `registro` é o número de inscrição (às vezes
com letra ou barra junto, tipo `"3788D"` ou `"0598/P"`). CORS está aberto
(`Access-Control-Allow-Origin: *`), então a chamada funciona de servidor —
testado direto por `curl`, sem navegador, sem cookie, sem passar por nenhum
desafio do Cloudflare que protege o resto do site.

**Por que é uma Edge Function, e não uma chamada direta do navegador:**
mesmo com CORS aberto, a decisão de marcar `verificado` precisa ser tomada
num lugar que o cliente não controla — senão bastaria pular a checagem e
mandar o `update` direto. A função usa a chave de serviço para gravar (é o
que o bypass `auth.role() = 'service_role'` no trigger
`proteger_campos_privilegiados` libera), e só verifica o CRN e o nome que já
estão no perfil de quem chamou — nunca o que vier no corpo da requisição.

**Critério de aprovação automática**, todos precisam bater:

1. Região + número de registro batem com um registro real.
2. `situacao` do registro é exatamente `"ATIVO"` — transferido, cancelado,
   baixa temporária ou provisório vencido caem para revisão manual mesmo
   com nome idêntico. Um registro que existiu não significa que ainda vale.
3. O nome do registro bate com o nome do cadastro, tolerando acento, caixa,
   espaço e nome do meio faltando/fora de ordem (mas não nomes diferentes).

Qualquer coisa fora disso — não achou, CFN fora do ar, resposta em formato
inesperado, CRN digitado de um jeito que não dá para interpretar — cai para
`'pendente'` sem lançar erro. Testado nos quatro caminhos, contra o CFN de
verdade: não encontrado, encontrado com nome divergente, encontrado com
situação inativa (nome batendo), e o caminho de sucesso completo (achou,
ativo, nome bate, gravou `verificado` no banco).

Chame pelo `Auth.tentarVerificarCrn()` do `js/auth.js` — hoje nada no site
chama isso automaticamente ainda; é o gate de login da Fase 3 que vai
disparar a tentativa assim que detectar `status_verificacao = 'pendente'`.

### Aprovação manual (`admin.html`)

Só visível — e só funcional — para quem tem `papel_admin = true` na própria
linha de `perfis`. Duas políticas de RLS fazem o trabalho de verdade
(`perfis_admin_le_tudo`, `perfis_admin_atualiza`); a página também confere
antes de desenhar qualquer coisa, mas isso é cortesia de UX, não a proteção.

⚠️ **Armadilha própria, corrigida:** a primeira versão dessas políticas usava
`exists (select 1 from public.perfis ...)` direto dentro da política de
`perfis` — e caiu em **"infinite recursion detected in policy for relation
perfis"**, porque avaliar a política reabre as políticas de SELECT de
`perfis`, incluindo ela mesma, de novo. Ficou consertado com uma função
`security definer` (`public.eh_admin()`), que confere `papel_admin` por fora
da RLS em vez de reabrir a política. Se um dia for escrever outra política
que precisa checar um campo da própria tabela, é esse o padrão — nunca um
`exists` direto na mesma tabela da política.

### Armadilha: update bloqueado responde como sucesso

Testado no banco: um nutricionista tentando alterar o paciente de outro recebe
**HTTP 204**, e nada muda. A RLS não rejeita o `update` — ela filtra a linha
antes, então a operação "dá certo" tendo alterado zero linhas.

Isso importa na camada de storage: `salvarPaciente()` não pode considerar
sucesso só porque não veio erro. Use `.select()` no fim do `update`/`upsert` e
confira que voltou linha — sem isso, a tela mostra "salvo" para uma alteração
que o banco descartou.

### Contas de teste que existem no projeto

Criadas para validar o schema, sem nenhum dado real:

| e-mail | senha | papel |
|---|---|---|
| `teste.nutri@nutrificha.test` | `senha-de-teste-123` | nutricionista, verificado |
| `teste.nutri2@nutrificha.test` | `senha-de-teste-123` | nutricionista, verificado, **admin de teste** (`papel_admin = true`) |
| `joana.nutri2@nutrificha.test` | `senha-de-teste-123` | nutricionista, verificado (aprovado pela tela admin.html, testando o botão de verdade) |
| `joana.nutri3@nutrificha.test` | `senha-de-teste-123` | nutricionista, **pendente** — cadastro completo (CPF/CRN/CEP) feito pela tela de verdade |
| `teste.paciente@nutrificha.test` | `senha-de-teste-123` | paciente, vinculado a "Maria Teste Editada" |
| `teste.paciente2@nutrificha.test` | `senha-de-teste-123` | paciente, vinculado a "Paciente de Teste" |

`teste.nutri` e `teste.nutri2` foram criadas antes da coluna
`status_verificacao` existir; receberam um `update status_verificacao =
'verificado'` manual (via SQL Editor) para não ficarem travadas quando o
gate de login da Fase 3 entrar no ar. `joana.nutri3` fica pendente de
propósito — é a conta para testar a tela de "cadastro em análise" (Fase 3) e
o card de pendente em `admin.html`.

`teste.nutri2` foi marcada `papel_admin = true` só para testar a tela
`admin.html` nesta fase. **A conta de admin de verdade, com o e-mail real do
Gabriel, é a Fase 4** — não confundir as duas.

As duas contas de paciente foram criadas numa janela em que **Confirm email**
estava temporariamente desligado — precisou ser assim porque o domínio de
teste (`@nutrificha.test`) não existe de verdade e o Supabase rejeita esse
domínio quando a confirmação está ligada (ver seção 5 acima). A confirmação
foi religada logo em seguida; as contas continuam funcionando normalmente.

Para apagar qualquer uma: **Authentication → Users**. Apagar a conta leva
junto os pacientes dela, por causa do `on delete cascade`.
