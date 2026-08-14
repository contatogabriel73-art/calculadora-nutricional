# NutriBloom — plataforma para nutricionistas

Aplicativo web (PWA) que monta uma **Ficha Técnica de Preparo** completa a partir
dos ingredientes: você digita o nome do alimento e os pesos, e o app preenche
sozinho os índices, os totais, a composição nutricional e o valor per capita,
usando a **Tabela TACO** (NEPA/UNICAMP).

Gera também a tabela nutricional no padrão de rótulo brasileiro (RDC 429/2020),
e guarda as fichas no prontuário de cada paciente.

HTML, CSS e JavaScript puros — **sem build, sem dependências, sem backend**.

> ## ⚠️ Estado atual: protótipo, banco de dados real por baixo
>
> **Login, dados clínicos e vínculo já são de verdade.** Contas com e-mail e
> senha no Supabase Auth, dados em Postgres com Row Level Security, e um
> código de convite liga a conta do paciente à ficha que o nutricionista
> mantém dele.
>
> Testado com contas reais, nos dois sentidos: um nutricionista não vê o
> paciente de outro, e um paciente não vê a ficha, a evolução, nem as fichas
> técnicas de outro paciente — mesmo tentando pelo id direto.
>
> **Só existe cadastro de nutricionista.** Pede CPF, CRN e endereço (CEP
> preenche o resto sozinho). Paciente não se cadastra pela landing: recebe
> um código do próprio nutricionista.
>
> **A verificação de CRN já roda de verdade, no login.** Uma Edge Function
> consulta a Consulta Nacional de Nutricionistas do CFN e confirma sozinha
> quando o registro existe, está ativo e o nome bate — a pessoa cadastra,
> entra, e já cai direto no painel, sem ver tela nenhuma de espera. Quando
> não consegue confirmar — CRN não encontrado, nome diferente, registro
> inativo, ou o CFN fora do ar — o cadastro fica `pendente` e a conta vê
> [`cadastro-em-analise.html`](cadastro-em-analise.html) em vez do painel,
> até um admin aprovar ou recusar na tela [`admin.html`](admin.html).
>
> **A conta de admin com o e-mail de verdade do Gabriel já existe** (Fase 4,
> criada com [`supabase/seed-conta-teste.js`](supabase/seed-conta-teste.js)) —
> ela aprova ou recusa cadastro pendente em [`admin.html`](admin.html). Ainda
> assim, use dados fictícios ao testar o resto: é prudência de quem está no
> meio de uma migração, não sinal de vulnerabilidade conhecida.
>
> Como montar o banco: [`supabase/README.md`](supabase/README.md).

### ▶ Testar agora

**<https://contatogabriel73-art.github.io/calculadora-nutricional/>**

Abre direto no celular. Para instalar como app: no Android, menu ⋮ →
*Instalar aplicativo*; no iPhone, Compartilhar → *Adicionar à Tela de Início*.
Depois de instalado funciona **offline**.

---

## As telas

| Página | O que é |
|---|---|
| `index.html` | Landing pública que apresenta o produto. |
| `login.html` | Entrada, com conta de verdade. |
| `cadastro.html` | Criação de conta de nutricionista — nome, CPF, CRN, endereço com CEP automático. |
| `area-paciente.html` | Área do paciente — código de vínculo, próxima consulta, gráficos de evolução, fichas/planos liberados. |
| `pacientes.html` | Lista, busca, cadastro e edição de pacientes. |
| `paciente.html?id=…` | Ficha do paciente e histórico de fichas técnicas. |
| `ficha.html` | A ferramenta de cálculo. |

Cada papel tem a sua área: o nutricionista cai no painel do consultório, o
paciente na área de acompanhamento. Quem abre a área do outro é devolvido
para a sua.

`cadastro.html` só cadastra nutricionista. Paciente não cria conta pela
landing — o nutricionista gera um código na ficha dele (aba Resumo →
"Gerar código de convite") e passa por fora do sistema.

### Modos da ferramenta de ficha

| URL | Comportamento |
|---|---|
| `ficha.html` | Ferramenta avulsa, sem paciente. |
| `ficha.html?paciente=ID` | Ficha nova, vinculada ao paciente. |
| `ficha.html?paciente=ID&ficha=FID` | Abre uma ficha já salva no prontuário. |

Dentro dela existem três abas:

| Aba | O que é |
|---|---|
| **Montar** | Onde você digita. Busca de alimentos, pesos, preço, modo de preparo e análise sensorial. |
| **Ficha Técnica** | O documento pronto, em 3 folhas A4, para imprimir ou salvar em PDF. |
| **Rótulo** | Tabela de informação nutricional no modelo ANVISA. |

---

## Arquitetura: os módulos que serão trocados por Supabase

A persistência e a autenticação foram isoladas de propósito. Para ligar um
backend real, **só estes três arquivos mudam** — nenhuma tela precisa ser tocada,
porque todas as funções já são assíncronas e as assinaturas não mudam:

| Módulo | Responsabilidade | Vira, no Supabase |
|---|---|---|
| `js/auth.js` | `login()`, `logout()`, `estaLogado()`, `usuarioAtual()`, `exigirLogin()` | `supabase.auth.*` |
| `js/pacientes-storage.js` | `listarPacientes()`, `obterPaciente()`, `salvarPaciente()`, `removerPaciente()`, `buscarPacientes()` | tabela `pacientes` |
| `js/fichas-storage.js` | `listarFichasDoPaciente()`, `obterFicha()`, `salvarFicha()`, `removerFicha()` | tabela `fichas` |

Os demais arquivos de apoio:

| Arquivo | Papel |
|---|---|
| `js/shell.js` | Cabeçalho comum das telas internas e utilidades (datas, iniciais, toast). |
| `js/ficha-paciente.js` | Única camada que sabe que uma ficha pertence a um paciente. |
| `app.js` | Toda a lógica de cálculo. Expõe `FichaTool` (`exportar`, `importar`, `resumo`, `titulo`, `aoMudar`) para a camada acima — não conhece pacientes. |

### Rascunho x ficha salva

São duas coisas diferentes, de propósito:

- **Rascunho** — o que está na tela agora, salvo a cada tecla. A chave varia
  conforme o contexto (`calc-nutri:rascunho:p:<id>`, `…:f:<id>`), para que uma
  ficha pela metade de um paciente não apareça na de outro.
- **Ficha salva** — o registro fechado no prontuário, gravado ao clicar em
  *Salvar no prontuário*. É esse que aparece no histórico do paciente.

Ao reabrir uma ficha salva que tenha rascunho pendente, o rascunho vence — são
edições não salvas, e descartá-las em silêncio seria pior. A barra do topo
mostra "alterações não salvas" nesse caso.

---

## O que o app calcula sozinho

Você informa apenas o que não dá para deduzir. Todo o resto é derivado:

### Por ingrediente

| Campo | Fórmula |
|---|---|
| **IC** — índice de correção | Peso bruto ÷ peso líquido inicial |
| **FC** — fator de cocção | Peso líquido final ÷ peso líquido inicial |
| **CB** — custo bruto | (Peso bruto ÷ 1000) × preço por kg |
| **CP** — custo por porção | CB ÷ nº de porções |
| **Medida caseira** | Convertida da base TACO ("200 g de arroz" → "8 colheres de sopa cheias"). Editável — se você mexer, o app para de sobrescrever. |
| **Calorias e macros** | Proporcional ao peso, direto da TACO |

**IR** (indicador de reidratação) é o único índice que fica manual: ele exige
saber qual peso é o seco e qual é o hidratado, e isso não dá para inferir dos
outros campos. Deixe em branco quando não se aplicar.

### Da preparação inteira

- Somatórios de peso bruto, líquido inicial e líquido final
- **Rendimento**: soma dos pesos finais, ou o peso que você pesar na balança
- **Per capita**: rendimento ÷ nº de porções — e editar o per capita recalcula o nº de porções
- **Fator de cocção da preparação**: rendimento ÷ peso líquido inicial total
- **Valor calórico da porção**, custo total e custo por porção
- **Valor nutritivo per capita** com a repartição calórica em % (Atwater: proteína 4, lipídio 9, glicídio 4 kcal/g)

### Detalhes que valem saber

- Na coluna **PL fin**, valores entre parênteses não foram medidos: o app assume
  que o ingrediente não muda de peso (óleo, sal) e usa o líquido inicial. É esse
  valor que entra no total, então a coluna sempre fecha com o somatório.
- O **Total** do bloco per capita é a soma das calorias dos macronutrientes pelos
  coeficientes de Atwater, que difere em alguns pontos das kcal tabeladas da TACO.
  Isso é esperado: a coluna % precisa somar 100%.
- A **base do cálculo nutricional** (peso bruto, líquido inicial ou líquido final)
  é escolhida no card *Rendimento*. O padrão é o líquido inicial. Escolha o peso
  que corresponde ao estado do alimento cadastrado — se você usou "Arroz cozido"
  da TACO, o peso coerente é o final.

---

## Como rodar localmente

O app precisa ser servido por HTTP. Abrir o `index.html` direto pelo Explorer
(`file://`) **não funciona**: o navegador bloqueia o `fetch` de `data/taco.json`
e não permite registrar o service worker.

```bash
node server.js
```

Depois abra <http://localhost:8080>. Para outra porta: `node server.js 3000`.

Qualquer outro servidor estático também serve:

```bash
npx serve .
```

### Atalhos de teclado

| Tecla | Ação |
|---|---|
| `↑` `↓` | Navega nas sugestões |
| `Enter` | Seleciona a sugestão / confirma a quantidade |
| `Esc` | Fecha as sugestões ou cancela a quantidade |

---

## Estrutura do projeto

```
calculadora/
├── index.html              Landing pública
├── login.html              Entrada (conta de verdade)
├── cadastro.html           Criar conta de nutricionista (CPF, CRN, CEP)
├── cadastro-em-analise.html  Tela de espera para quem está pendente/recusado
├── admin.html              Aprovar/recusar cadastro (só para papel_admin)
├── area-paciente.html      Área do paciente (só leitura)
├── pacientes.html          Lista e cadastro de pacientes
├── paciente.html           Detalhe do paciente + histórico de fichas
├── ficha.html              A ferramenta: 3 abas e as 3 folhas da ficha
├── styles.css              Tokens, componentes e a ficha (com impressão A4)
├── plataforma.css          Landing, login, pacientes e casca do sistema
├── app.js                  Busca, cálculo, renderização e PWA. Expõe FichaTool
├── js/
│   ├── supabase-config.js  URL e chave pública do projeto
│   ├── supabase-client.js  Conexão única com o banco
│   ├── auth.js             Contas, papéis e guarda de rota
│   ├── cpf.js              Máscara e dígito verificador (sem consulta externa)
│   ├── cep.js              Preenchimento de endereço pela ViaCEP
│   ├── admin-storage.js    Listar/aprovar/recusar cadastro pendente
│   ├── pacientes-storage.js ← trocar por tabela `pacientes`
│   ├── fichas-storage.js   ← trocar por tabela `fichas_tecnicas`
│   ├── shell.js            Cabeçalho comum e utilidades
│   └── ficha-paciente.js   Vínculo ficha ↔ paciente
├── supabase/
│   ├── schema.sql          Tabelas, gatilhos e Row Level Security
│   ├── functions/
│   │   └── verificar-crn/index.ts   Edge Function — confirma CRN no CFN
│   └── README.md           Como montar o banco
├── manifest.json           Manifesto do PWA
├── sw.js                   Service worker (offline)
├── server.js               Servidor estático de desenvolvimento
├── data/
│   └── taco.json           Base de alimentos  ← ponto de expansão
├── icons/
│   ├── icon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── tools/
    └── gen-icons.js        Regera os PNGs a partir do desenho vetorial
```

---

## Expandindo a base TACO

O protótipo vem com **71 alimentos** representativos. A TACO completa tem 597.
Para expandir, basta acrescentar objetos ao array `alimentos` de
`data/taco.json` — **nenhuma alteração de código é necessária**, o app lê o
arquivo inteiro em tempo de execução e se adapta ao tamanho da base.

```json
{
  "id": 72,
  "nome": "Abacaxi, cru",
  "categoria": "Frutas",
  "fonte": "TACO",
  "acucaresEstimado": true,
  "por100g": {
    "kcal": 48,
    "carboidratos": 12.3,
    "proteinas": 0.9,
    "gordurasTotais": 0.1,
    "gordurasSaturadas": 0.0,
    "fibras": 1.0,
    "acucares": 9.9,
    "sodio": 0
  },
  "medidas": [
    { "nome": "Fatia média", "gramas": 75 }
  ]
}
```

Regras:

- **`id`** precisa ser único e estável. Ele é o que fica salvo no `localStorage`;
  se você reutilizar um `id` para outro alimento, fichas salvas passam a apontar
  para o alimento errado. Alimentos que somem da base são descartados na
  restauração, com aviso ao usuário — não quebram o app.
- **`por100g`** exige as oito chaves acima, sempre por 100 g de parte comestível.
  Chave ausente é tratada como `0`.
- **`medidas`** é opcional, mas é o que alimenta a coluna *Medida Caseira* da
  ficha. Sem ela, o campo fica em branco para preenchimento manual.
- **`categoria`** entra no índice de busca, então dá para achar o alimento
  buscando pela categoria.

### Sobre os dados

- A TACO **não publica açúcares totais**. Os valores de `acucares` são
  estimativas derivadas de tabelas complementares (USDA / IBGE-POF) e ficam
  marcados com `"acucaresEstimado": true`. O rótulo exibe um `†` e a nota
  correspondente sempre que algum ingrediente usa valor estimado.
- Alguns itens que não constam na TACO (grão-de-bico cozido, tofu, atum em
  conserva) vêm da base **USDA FoodData Central**, marcados com `"fonte": "USDA"`.
- Os valores são **médias de referência**. Variam conforme cultivar, origem,
  corte e preparo. Não substituem orientação de nutricionista.

---

## Cache e atualizações

O service worker usa **stale-while-revalidate** para o app shell: a página abre
instantânea a partir do cache e baixa a versão nova em segundo plano. Uma
correção publicada chega para o usuário **na abertura seguinte**, sem que ele
precise limpar nada.

A constante `CACHE` em `sw.js` só precisa ser incrementada quando você quiser
descartar todos os caches antigos de uma vez — não a cada deploy.

`data/taco.json` usa *network-first*: alimentos novos chegam já na primeira
abertura com internet.

**Detalhe que não é opcional:** todo fetch do service worker passa por
`buscarDaRede()`, que usa `cache: 'no-cache'`. O GitHub Pages serve os assets
com `Cache-Control: max-age=600`, então um `fetch()` comum é atendido pelo cache
HTTP do navegador — e o service worker acabaria regravando os mesmos bytes
velhos por 10 minutos, anulando o *stale-while-revalidate*. Com `no-cache` o
navegador revalida por ETag e devolve 304 quando nada mudou, então o custo é
baixo.

Por isso o `server.js` de desenvolvimento também envia `max-age=600`: com
`no-cache` local, o ambiente deixava de reproduzir a produção e escondia
exatamente esse tipo de bug.

### Atualização automática

Quando um service worker novo assume o controle, a página aberta ainda está
rodando o código antigo. O app escuta `controllerchange` e recarrega **uma
vez**, então a versão nova entra sozinha, sem o usuário precisar abrir o app
duas vezes — algo que passava despercebido no celular e parecia "a correção
não saiu".

A primeira posse de controlador não conta: numa visita inicial a página carrega
sem controlador e o `clients.claim()` dispara um `controllerchange` que não
significa versão nova.

O rodapé mostra a versão em execução (`VERSAO_APP` em `app.js`). Ao publicar,
incremente `VERSAO_APP` **e** `CACHE` em `sw.js` — assim dá para confirmar,
olhando o app, se o aparelho já recebeu a atualização.

---

## Regerando os ícones

```bash
node tools/gen-icons.js
```

Edite as constantes no topo de `tools/gen-icons.js` para mudar a cor da marca.
Se alterar o desenho, ajuste também `icons/icon.svg` para manter os dois iguais.

---

## Próximos passos

Na ordem em que fazem sentido:

1. **Supabase** — autenticação real e banco de dados. Trocar os três módulos
   listados acima; nenhuma tela precisa mudar. É o que destrava usar com
   paciente de verdade.
2. **Agendamento** — agenda de consultas ligada ao cadastro de pacientes.
3. Importar a TACO completa (597 alimentos) — ver *Expandindo a base*.
4. Escrever direto na ficha impressa (modo de preparo, análise sensorial),
   em vez de só na aba Montar.
5. Exportar a ficha em `.docx` além de PDF.
6. Gorduras trans e colesterol (a TACO traz colesterol; trans não).
