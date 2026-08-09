# Calculadora Nutricional — Tabela TACO

Aplicativo web (PWA) para montar uma receita a partir de ingredientes da
**Tabela TACO** (Tabela Brasileira de Composição de Alimentos, NEPA/UNICAMP)
e obter a tabela nutricional somada, no formato de rótulo brasileiro.

HTML, CSS e JavaScript puros — **sem build, sem dependências, sem backend**.

---

## Como rodar

O app precisa ser servido por HTTP. Abrir o `index.html` direto pelo Explorer
(`file://`) **não funciona**: o navegador bloqueia o `fetch` de `data/taco.json`
e não permite registrar o service worker.

```bash
node server.js
```

Depois abra <http://localhost:8080>.

Para usar outra porta: `node server.js 3000`.

Qualquer outro servidor estático também serve:

```bash
npx serve .
```

> No VS Code, a extensão **Live Server** funciona igualmente bem.

### Instalando no celular

Abra o app pelo Chrome e use **Instalar app** (o botão aparece no cabeçalho
quando o navegador oferece a instalação) ou o menu ⋮ → *Adicionar à tela inicial*.
No iOS, use Compartilhar → *Adicionar à Tela de Início*.

Para instalar num aparelho físico, o app precisa estar em `https://` ou em
`localhost` — as duas origens que os navegadores consideram contexto seguro.
Publicar em GitHub Pages, Netlify ou Vercel é suficiente: é só subir a pasta
inteira, não há etapa de build.

---

## Como usar

1. **Busque um ingrediente** no campo de busca. A busca ignora acentos
   (`acucar` acha *Açúcar*) e aceita várias palavras (`frango peito`).
   Também funciona por categoria (`frutas`, `leguminosas`).
2. **Informe a quantidade** em gramas ou escolha uma **medida caseira**
   (colher de sopa, unidade média, concha…) quando o alimento tiver uma.
3. **Repita** para todos os ingredientes. A lista permite editar a quantidade
   direto no campo ou remover o item no ✕. Zerar a quantidade remove o item.
4. **Defina quantas porções** a receita rende. O rótulo mostra os valores
   por porção e por 100 g.

A receita é salva automaticamente no `localStorage`, então recarregar a página
não perde nada. **Copiar como texto** gera uma versão em texto puro da tabela;
**Imprimir / PDF** imprime apenas o rótulo.

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
├── index.html          Marcação da interface e do rótulo
├── styles.css          Estilos (mobile-first, 2 colunas ≥ 900px)
├── app.js              Busca, cálculo, rótulo, persistência e PWA
├── manifest.json       Manifesto do PWA
├── sw.js               Service worker (offline)
├── server.js           Servidor estático de desenvolvimento
├── data/
│   └── taco.json       Base de alimentos  ← ponto de expansão
├── icons/
│   ├── icon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-maskable-512.png
└── tools/
    └── gen-icons.js    Regera os PNGs a partir do desenho vetorial
```

---

## Expandindo a base TACO

O protótipo vem com **71 alimentos** representativos. A TACO completa tem 597.
Para expandir, basta acrescentar objetos ao array `alimentos` de
`data/taco.json` — **nenhuma alteração de código é necessária**, o app lê o
arquivo inteiro em tempo de execução e se adapta ao tamanho da base.

Formato de cada alimento:

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
  se você reutilizar um `id` para outro alimento, receitas salvas passam a
  apontar para o alimento errado. Alimentos que somem da base são descartados
  na restauração, com aviso ao usuário — não quebram o app.
- **`por100g`** exige as oito chaves acima, sempre por 100 g de parte comestível.
  Chave ausente é tratada como `0`.
- **`medidas`** é opcional. Sem ela, o usuário só informa gramas.
- **`categoria`** entra no índice de busca, então o usuário consegue achar o
  alimento buscando pela categoria.

Depois de editar o JSON, recarregue a página. Como `data/taco.json` usa
estratégia *network-first* no service worker, a versão nova chega na primeira
abertura com internet — não é preciso limpar o cache.

### Sobre os dados

- A TACO **não publica açúcares totais**. Os valores de `acucares` são
  estimativas derivadas de tabelas complementares (USDA / IBGE-POF) e ficam
  marcados com `"acucaresEstimado": true`. O rótulo exibe um `†` e a nota
  correspondente sempre que algum ingrediente da receita usa valor estimado.
- Alguns itens que não constam na TACO (grão-de-bico cozido, tofu, atum em
  conserva) vêm da base **USDA FoodData Central** e estão marcados com
  `"fonte": "USDA"`.
- Os valores são **médias de referência**. Variam conforme cultivar, origem,
  corte e preparo. Não substituem orientação de nutricionista.

---

## Detalhes de cálculo

- Cada ingrediente contribui com `valor_por_100g × (gramas / 100)`.
- A coluna **100 g** é a receita pronta normalizada: `total × 100 / peso_total`.
  Ela não é a soma dos "por 100 g" dos ingredientes — é a composição da mistura.
- A coluna **Porção** é `total / número_de_porções`.
- **%VD** usa os Valores Diários da
  [RDC 429/2020](https://www.gov.br/anvisa/pt-br) e IN 75/2020 (ANVISA), para uma
  dieta de 2.000 kcal: energia 2.000 kcal, carboidratos 300 g, proteínas 50 g,
  gorduras totais 55 g, gorduras saturadas 22 g, fibra 25 g e sódio 2.000 mg.
  Esses números ficam em `valoresDiarios`, no próprio `taco.json`.
- **Açúcares totais** aparecem sem %VD (—) porque a legislação não define
  Valor Diário para esse nutriente.
- O cálculo considera apenas a soma dos ingredientes crus/preparados como
  cadastrados. **Perda de água no cozimento não é modelada** — se você cadastra
  arroz cru e serve cozido, o peso total não corresponde ao prato final.
  Prefira cadastrar os alimentos já na forma em que serão consumidos.

---

## Regerando os ícones

Os PNGs do PWA são gerados por script, sem dependências externas:

```bash
node tools/gen-icons.js
```

Edite as constantes no topo de `tools/gen-icons.js` para mudar a cor da marca.
Se alterar o desenho, ajuste também `icons/icon.svg` para manter os dois iguais.

---

## Cache e versionamento

Ao alterar `index.html`, `styles.css`, `app.js` ou os ícones, **incremente a
constante `CACHE`** em `sw.js` (`nutri-taco-v1` → `nutri-taco-v2`). Sem isso,
usuários que já instalaram o app continuam recebendo a versão em cache.

O JSON da base não precisa disso: ele usa *network-first* e sempre tenta a rede
antes de cair para o cache.

---

## Próximos passos possíveis

- Importar a TACO completa (597 alimentos) — ver *Expandindo a base*.
- Salvar múltiplas receitas nomeadas, não só a receita atual.
- Exportar o rótulo como imagem.
- Campo de peso final do prato, para corrigir a perda de água no cozimento.
- Gorduras trans e colesterol (a TACO traz colesterol; trans não).
