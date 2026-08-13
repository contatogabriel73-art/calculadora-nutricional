# Banco de dados (Supabase)

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

## 5. E-mail de confirmação (na Fase 2)

Por padrão o Supabase exige confirmação de e-mail no cadastro, e o serviço de
e-mail embutido tem limite baixo (poucas mensagens por hora), o que atrapalha
enquanto se testa.

Em **Authentication → Providers → Email**, durante o desenvolvimento, dá para
desligar **Confirm email**. Antes de usar com paciente de verdade, **ligue de
novo**: sem confirmação, qualquer pessoa cria conta com o e-mail de outra.

---

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
