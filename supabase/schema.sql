-- ============================================================
--  NutriFicha — estrutura do banco (Supabase / Postgres)
--
--  Como usar: abra o painel do Supabase → SQL Editor → New query,
--  cole este arquivo inteiro e rode. Ele é idempotente: pode ser
--  rodado de novo sem duplicar nada.
--
--  ⚠️ Dado de paciente é dado de saúde — a categoria mais sensível
--  da LGPD. Toda tabela aqui nasce com Row Level Security LIGADA e
--  com política explícita. Sem RLS, a chave anônima (que fica
--  visível no código do site) daria acesso ao banco inteiro.
--
--  Regra que vale para o arquivo todo:
--    • nutricionista_id → é um auth.users.id (a conta do profissional)
--    • paciente_id      → é um pacientes.id (a FICHA do paciente, que
--                         existe mesmo que ele nunca crie conta)
--    • pacientes.usuario_id → auth.users.id da conta do paciente,
--                         preenchido só quando ele se vincula (Fase 4)
-- ============================================================

-- gen_random_uuid(). Já vem habilitado em projetos novos do Supabase;
-- a linha existe para o arquivo funcionar num Postgres limpo também.
create extension if not exists pgcrypto;


-- ============================================================
--  Funções auxiliares
-- ============================================================

-- Mantém `atualizado_em` sempre correto sem depender do cliente.
-- Se o navegador mandar um valor errado, o banco corrige.
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;


-- ============================================================
--  perfis — uma linha por conta, com o papel
-- ============================================================
-- O papel decide para onde a pessoa vai depois do login e o que ela
-- pode ver. Fica no banco (e não só no metadata do auth) porque as
-- políticas de RLS precisam consultá-lo.
--
-- Os campos crn/documento/endereco/cidade são do emitente do recibo
-- (o que hoje vive em perfil-storage.js) e só interessam ao
-- nutricionista; num perfil de paciente ficam vazios.

create table if not exists public.perfis (
  id             uuid primary key references auth.users (id) on delete cascade,
  papel          text        not null check (papel in ('nutricionista', 'paciente')),
  nome           text        not null default '',
  email          text        not null default '',
  crn            text        not null default '',
  documento      text        not null default '',
  telefone       text        not null default '',
  endereco       text        not null default '',
  cidade         text        not null default '',
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- Colunas adicionadas depois da criação da tabela — `alter ... add column
-- if not exists` em vez de colocar tudo dentro do `create table`, para o
-- schema.sql continuar seguro de rodar de novo num banco que já tem dados.
--
-- Endereço estruturado (preenchido por CEP na tela de cadastro) é separado
-- do `endereco` de texto livre acima: aquele é o que aparece no recibo,
-- digitado à mão; este é o que a verificação de CRN usa para restringir a
-- busca por UF na Consulta Nacional de Nutricionistas.
alter table public.perfis add column if not exists cpf              text not null default '';
alter table public.perfis add column if not exists cep              text not null default '';
alter table public.perfis add column if not exists rua              text not null default '';
alter table public.perfis add column if not exists numero           text not null default '';
alter table public.perfis add column if not exists complemento      text not null default '';
alter table public.perfis add column if not exists bairro           text not null default '';
alter table public.perfis add column if not exists estado           text not null default '';

-- Só tem sentido para nutricionista — ver criar_perfil_no_cadastro(). Um
-- paciente não passa por verificação de CRN nenhuma, então a coluna fica
-- nula para ele, e a checagem na aplicação só olha isto quando papel =
-- 'nutricionista'.
alter table public.perfis add column if not exists status_verificacao
  text check (status_verificacao in ('pendente', 'verificado', 'recusado'));

-- Conta criada por script de seed, fora do cadastro normal — pula a
-- verificação de CRN de propósito. Existe para o Gabriel testar e para
-- administrar os cadastros pendentes (papel_admin). Nunca marcada por
-- conta própria: nenhuma tela de cadastro grava estas duas colunas.
alter table public.perfis add column if not exists conta_teste  boolean not null default false;
alter table public.perfis add column if not exists papel_admin boolean not null default false;

drop trigger if exists trg_perfis_atualizado_em on public.perfis;
create trigger trg_perfis_atualizado_em
  before update on public.perfis
  for each row execute function public.tocar_atualizado_em();


-- ============================================================
--  pacientes — a ficha do paciente, criada pelo nutricionista
-- ============================================================
-- `usuario_id` é NULO na maioria dos casos e isso é proposital: nem
-- todo paciente vai querer criar conta, e o nutricionista precisa
-- continuar trabalhando normalmente com esses. O vínculo é um extra,
-- não um requisito.
--
-- `codigo_convite` é o que o paciente digita no cadastro dele para
-- assumir a própria ficha. A geração fica para a Fase 4; a coluna
-- nasce aqui para não precisar mexer na tabela depois.

create table if not exists public.pacientes (
  id               uuid primary key default gen_random_uuid(),
  nutricionista_id uuid        not null references auth.users (id) on delete cascade,
  usuario_id       uuid                 references auth.users (id) on delete set null,
  codigo_convite   text        unique,
  nome             text        not null check (length(trim(nome)) > 0),
  nascimento       date,
  sexo             text        not null default '' check (sexo in ('', 'F', 'M')),
  telefone         text        not null default '',
  email            text        not null default '',
  observacoes      text        not null default '',
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  -- Alvo da chave estrangeira composta usada por todas as tabelas
  -- filhas. É o que impede uma consulta de apontar para um paciente
  -- de outro nutricionista.
  unique (id, nutricionista_id)
);

create index if not exists idx_pacientes_nutricionista
  on public.pacientes (nutricionista_id);
create index if not exists idx_pacientes_usuario
  on public.pacientes (usuario_id) where usuario_id is not null;

drop trigger if exists trg_pacientes_atualizado_em on public.pacientes;
create trigger trg_pacientes_atualizado_em
  before update on public.pacientes
  for each row execute function public.tocar_atualizado_em();


-- ============================================================
--  consultas — agenda
-- ============================================================

create table if not exists public.consultas (
  id               uuid primary key default gen_random_uuid(),
  nutricionista_id uuid        not null references auth.users (id) on delete cascade,
  paciente_id      uuid        not null,
  data             date        not null,
  hora             time        not null,
  duracao          integer     not null default 60 check (duracao > 0),
  tipo             text        not null default 'Consulta',
  status           text        not null default 'agendada'
                     check (status in ('agendada', 'confirmada', 'realizada', 'cancelada')),
  observacoes      text        not null default '',
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  foreign key (paciente_id, nutricionista_id)
    references public.pacientes (id, nutricionista_id) on delete cascade
);

create index if not exists idx_consultas_nutri_data
  on public.consultas (nutricionista_id, data);
create index if not exists idx_consultas_paciente
  on public.consultas (paciente_id, data);

drop trigger if exists trg_consultas_atualizado_em on public.consultas;
create trigger trg_consultas_atualizado_em
  before update on public.consultas
  for each row execute function public.tocar_atualizado_em();


-- ============================================================
--  pagamentos — financeiro
-- ============================================================
-- Valores em CENTAVOS (inteiro), como já era no financeiro-storage.js:
-- somar reais em ponto flutuante acumula erro e some centavo no relatório.
--
-- `consulta_id` é opcional de propósito — pacote, plano mensal e retorno
-- cortesia não correspondem a um atendimento avulso.

create table if not exists public.pagamentos (
  id               uuid primary key default gen_random_uuid(),
  nutricionista_id uuid        not null references auth.users (id) on delete cascade,
  paciente_id      uuid        not null,
  consulta_id      uuid                 references public.consultas (id) on delete set null,
  data             date        not null,
  data_pagamento   date,
  centavos         integer     not null check (centavos > 0),
  forma            text        not null default '',
  status           text        not null default 'pendente' check (status in ('pago', 'pendente')),
  descricao        text        not null default 'Consulta de nutrição',
  observacoes      text        not null default '',
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  foreign key (paciente_id, nutricionista_id)
    references public.pacientes (id, nutricionista_id) on delete cascade
);

create index if not exists idx_pagamentos_nutri_data
  on public.pagamentos (nutricionista_id, data);
create index if not exists idx_pagamentos_paciente
  on public.pagamentos (paciente_id);

drop trigger if exists trg_pagamentos_atualizado_em on public.pagamentos;
create trigger trg_pagamentos_atualizado_em
  before update on public.pagamentos
  for each row execute function public.tocar_atualizado_em();


-- ============================================================
--  anamneses — dado FIXO, uma por paciente
-- ============================================================
-- Retrato do histórico de saúde. Atualiza em vez de acumular versões:
-- alergia e cirurgia antiga não mudam a cada consulta.
-- O `unique (paciente_id)` é o que garante "uma por paciente".

create table if not exists public.anamneses (
  id                       uuid primary key default gen_random_uuid(),
  nutricionista_id         uuid        not null references auth.users (id) on delete cascade,
  paciente_id              uuid        not null unique,
  historico_saude          text        not null default '',
  medicamentos             text        not null default '',
  queixas                  text        not null default '',
  habitos                  text        not null default '',
  restricoes               text        not null default '',
  alergias                 text        not null default '',
  atividade_fisica         text        not null default '',
  sono                     text        not null default '',
  hidratacao               text        not null default '',
  funcionamento_intestinal text        not null default '',
  observacoes              text        not null default '',
  criado_em                timestamptz not null default now(),
  atualizado_em            timestamptz not null default now(),

  foreign key (paciente_id, nutricionista_id)
    references public.pacientes (id, nutricionista_id) on delete cascade
);

drop trigger if exists trg_anamneses_atualizado_em on public.anamneses;
create trigger trg_anamneses_atualizado_em
  before update on public.anamneses
  for each row execute function public.tocar_atualizado_em();


-- ============================================================
--  avaliacoes — dado EVOLUTIVO, várias por paciente
-- ============================================================
-- Cada consulta cria um registro NOVO, datado. Nunca sobrescreve.
-- É esta tabela — e só ela — que vira gráfico de evolução.
--
-- peso/altura são numeric (e não texto) porque o gráfico precisa
-- ordenar e interpolar. circunferencias e dobras vão em jsonb porque
-- o conjunto de pontos medidos varia de protocolo para protocolo.

create table if not exists public.avaliacoes (
  id               uuid primary key default gen_random_uuid(),
  nutricionista_id uuid        not null references auth.users (id) on delete cascade,
  paciente_id      uuid        not null,
  data             date        not null,
  peso             numeric(6, 2) check (peso is null or peso > 0),
  altura           numeric(5, 2) check (altura is null or altura > 0),
  circunferencias  jsonb       not null default '{}'::jsonb,
  dobras           jsonb       not null default '{}'::jsonb,
  observacoes      text        not null default '',
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  foreign key (paciente_id, nutricionista_id)
    references public.pacientes (id, nutricionista_id) on delete cascade
);

create index if not exists idx_avaliacoes_paciente_data
  on public.avaliacoes (paciente_id, data desc);

drop trigger if exists trg_avaliacoes_atualizado_em on public.avaliacoes;
create trigger trg_avaliacoes_atualizado_em
  before update on public.avaliacoes
  for each row execute function public.tocar_atualizado_em();


-- ============================================================
--  fichas_tecnicas — ficha de preparo + rótulo, salva por paciente
-- ============================================================
-- `conteudo` guarda o estado completo da ferramenta (campos +
-- ingredientes) e `resumo` os números já calculados, para a listagem
-- não precisar recarregar a base TACO e refazer as contas.
--
-- `visivel_paciente` existe desde já para a Fase 5: o paciente só vê
-- o que o nutricionista liberou explicitamente.

create table if not exists public.fichas_tecnicas (
  id               uuid primary key default gen_random_uuid(),
  nutricionista_id uuid        not null references auth.users (id) on delete cascade,
  paciente_id      uuid        not null,
  titulo           text        not null default 'Preparação sem nome',
  conteudo         jsonb       not null default '{}'::jsonb,
  resumo           jsonb       not null default '{}'::jsonb,
  visivel_paciente boolean     not null default false,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  foreign key (paciente_id, nutricionista_id)
    references public.pacientes (id, nutricionista_id) on delete cascade
);

create index if not exists idx_fichas_paciente
  on public.fichas_tecnicas (paciente_id, atualizado_em desc);

drop trigger if exists trg_fichas_atualizado_em on public.fichas_tecnicas;
create trigger trg_fichas_atualizado_em
  before update on public.fichas_tecnicas
  for each row execute function public.tocar_atualizado_em();


-- ============================================================
--  planos — plano alimentar (vários por paciente)
-- ============================================================

create table if not exists public.planos (
  id               uuid primary key default gen_random_uuid(),
  nutricionista_id uuid        not null references auth.users (id) on delete cascade,
  paciente_id      uuid        not null,
  nome             text        not null default 'Plano alimentar',
  data             date        not null default current_date,
  observacoes      text        not null default '',
  refeicoes        jsonb       not null default '[]'::jsonb,
  resumo           jsonb       not null default '{}'::jsonb,
  visivel_paciente boolean     not null default false,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  foreign key (paciente_id, nutricionista_id)
    references public.pacientes (id, nutricionista_id) on delete cascade
);

create index if not exists idx_planos_paciente
  on public.planos (paciente_id, atualizado_em desc);

drop trigger if exists trg_planos_atualizado_em on public.planos;
create trigger trg_planos_atualizado_em
  before update on public.planos
  for each row execute function public.tocar_atualizado_em();


-- ============================================================
--  metas — uma por paciente, referência para todos os planos dele
-- ============================================================

create table if not exists public.metas (
  id               uuid primary key default gen_random_uuid(),
  nutricionista_id uuid        not null references auth.users (id) on delete cascade,
  paciente_id      uuid        not null unique,
  peso_meta        numeric(6, 2),
  kcal_meta        numeric(7, 2),
  pct_proteina     numeric(5, 2),
  pct_carboidrato  numeric(5, 2),
  pct_lipidio      numeric(5, 2),
  observacoes      text        not null default '',
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),

  foreign key (paciente_id, nutricionista_id)
    references public.pacientes (id, nutricionista_id) on delete cascade
);

drop trigger if exists trg_metas_atualizado_em on public.metas;
create trigger trg_metas_atualizado_em
  before update on public.metas
  for each row execute function public.tocar_atualizado_em();


-- ============================================================
--  Criação automática do perfil no cadastro
-- ============================================================
-- Roda quando o Supabase Auth cria a conta, lendo o papel e o nome que
-- o formulário de cadastro mandou em `options.data`.
--
-- Existe como trigger, e não como um insert feito pelo site, porque um
-- insert do navegador pode falhar depois do cadastro ter dado certo
-- (conexão caiu, aba fechada) e deixaria uma conta sem perfil — sem
-- papel, sem saber para onde mandar a pessoa no login.
--
-- Sem papel informado assume nutricionista: é o caminho que o site usa
-- por padrão, e errar para esse lado só mostra um painel vazio; errar
-- para 'paciente' trancaria a pessoa numa área sem nada e sem saída.
--
-- `status_verificacao` só existe de verdade para nutricionista: todo
-- cadastro novo pelo formulário público nasce 'pendente', e só sai disso
-- pela Fase 2 (verificação automática de CRN) ou por um admin aprovando
-- na mão. Paciente não passa por nada disso — a coluna fica nula, e a
-- aplicação só confere esse campo quando o papel é nutricionista.
--
-- cpf/crn/cep/rua/numero/complemento/bairro/estado só vêm preenchidos
-- quando quem cadastrou foi o formulário do nutricionista; a página de
-- código de convite (papel = paciente) não manda nenhum desses campos,
-- e `coalesce(..., '')` cobre a ausência sem quebrar o insert.

create or replace function public.criar_perfil_no_cadastro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o_papel text := case
    when coalesce(new.raw_user_meta_data ->> 'papel', '') = 'paciente' then 'paciente'
    else 'nutricionista'
  end;
begin
  insert into public.perfis (
    id, papel, nome, email, cpf, crn,
    cep, rua, numero, complemento, bairro, cidade, estado,
    status_verificacao
  )
  values (
    new.id,
    o_papel,
    coalesce(new.raw_user_meta_data ->> 'nome', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'cpf', ''),
    coalesce(new.raw_user_meta_data ->> 'crn', ''),
    coalesce(new.raw_user_meta_data ->> 'cep', ''),
    coalesce(new.raw_user_meta_data ->> 'rua', ''),
    coalesce(new.raw_user_meta_data ->> 'numero', ''),
    coalesce(new.raw_user_meta_data ->> 'complemento', ''),
    coalesce(new.raw_user_meta_data ->> 'bairro', ''),
    coalesce(new.raw_user_meta_data ->> 'cidade', ''),
    coalesce(new.raw_user_meta_data ->> 'estado', ''),
    case when o_papel = 'nutricionista' then 'pendente' else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_criar_perfil on auth.users;
create trigger trg_criar_perfil
  after insert on auth.users
  for each row execute function public.criar_perfil_no_cadastro();


-- ============================================================
--  Proteção dos campos privilegiados de `perfis`
-- ============================================================
-- A política de RLS abaixo (perfis_atualizar_proprio) deixa qualquer
-- usuário atualizar a PRÓPRIA linha — é assim que o nutricionista edita
-- nome/telefone/endereço. Mas RLS não filtra coluna, só linha: sem esta
-- trava, nada impediria alguém de mandar um update incluindo
-- `status_verificacao: 'verificado'` direto pelo console do navegador e
-- se autoaprovar, pulando a verificação de CRN inteira.
--
-- Só quem já é admin (`papel_admin`) pode mudar estes quatro campos —
-- é a tela de aprovação da Fase 2 que faz isso, sempre autenticada como
-- admin. Ninguém mais, nem o próprio dono da linha.

create or replace function public.proteger_campos_privilegiados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eh_admin boolean;
begin
  -- Conexão direta ao banco (SQL Editor, migração, script de manutenção)
  -- roda como `postgres` e não tem JWT nenhum — auth.uid() vem nulo
  -- nesse caso, não porque ninguém está autenticado, mas porque não é
  -- uma requisição da API. PostgREST nunca assume esse papel para
  -- pedido de cliente (usa `anon` ou `authenticated`), então checar
  -- `session_user` aqui não abre brecha para o navegador — só libera
  -- quem já tem acesso direto ao banco, que é mais privilégio do que
  -- esta trava tenta conter.
  if session_user = 'postgres' then
    return new;
  end if;

  -- A Edge Function de verificação de CRN (Fase 2) conecta com a chave
  -- service_role — é o único jeito de ela gravar 'verificado' depois de
  -- confirmar o registro no CFN. `auth.role()` lê o papel de dentro do
  -- JWT que a própria Supabase valida antes de deixar a requisição
  -- chegar aqui; só quem tem a chave secreta (guardada só no servidor
  -- da função, nunca no navegador) consegue montar um JWT com esse
  -- papel. Não é a mesma coisa que um usuário comum marcar a si mesmo
  -- como service_role — isso é impossível sem a chave.
  if auth.role() = 'service_role' then
    return new;
  end if;

  select papel_admin into eh_admin from public.perfis where id = auth.uid();

  if not coalesce(eh_admin, false) then
    new.status_verificacao := old.status_verificacao;
    new.papel               := old.papel;
    new.papel_admin         := old.papel_admin;
    new.conta_teste         := old.conta_teste;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protege_privilegiados on public.perfis;
create trigger trg_protege_privilegiados
  before update on public.perfis
  for each row execute function public.proteger_campos_privilegiados();


-- ============================================================
--  Vínculo do paciente com o nutricionista (código de convite)
-- ============================================================
-- O nutricionista gera um código na ficha do paciente e passa para ele.
-- O paciente digita esse código na área dele e a ficha passa a ser
-- também dele.
--
-- Por que isto precisa ser uma função no banco, e não um update do
-- navegador: um paciente ainda sem vínculo não enxerga NENHUMA linha de
-- `pacientes` — é o que a Row Level Security garante. Logo ele não
-- consegue procurar a ficha pelo código, nem gravar `usuario_id` nela.
-- A função roda como dona da tabela (`security definer`), então ela
-- enxerga o que precisa; e faz só isto, sem devolver dado nenhum além
-- do necessário.
--
-- `search_path` fixo é obrigatório numa função `security definer`: sem
-- ele, quem chama poderia criar um schema próprio na frente do caminho
-- e sequestrar os nomes de tabela usados aqui dentro.

create or replace function public.resgatar_convite(codigo text)
returns table (paciente_id uuid, nutricionista_nome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  alvo   public.pacientes;
  papel  text;
  vnome  text;
begin
  select p.papel into papel from public.perfis p where p.id = auth.uid();

  if papel is null then
    raise exception 'Entre na sua conta para usar um código.';
  end if;

  -- Um nutricionista não vira paciente de outro digitando um código:
  -- as duas contas veem coisas diferentes e a troca bagunçaria os dois.
  if papel <> 'paciente' then
    raise exception 'Só uma conta de paciente pode usar um código de convite.';
  end if;

  -- Uma conta de paciente liga a UMA ficha. Sem este check, nada no
  -- banco impediria a mesma conta resgatar um segundo código e passar a
  -- apontar para duas fichas — e a área do paciente, que assume um
  -- vínculo só, quebraria ao tentar decidir qual delas mostrar.
  if exists (select 1 from public.pacientes where usuario_id = auth.uid()) then
    raise exception 'Esta conta já está vinculada a um nutricionista.';
  end if;

  select * into alvo
    from public.pacientes
   where codigo_convite = upper(btrim(codigo))
     and usuario_id is null
   limit 1;

  if not found then
    -- Mesma mensagem para código errado e código já usado, de propósito:
    -- distinguir os dois ajudaria quem estivesse testando códigos no chute.
    raise exception 'Código inválido ou já utilizado.';
  end if;

  update public.pacientes
     set usuario_id = auth.uid(),
         -- Uso único: o código morre ao ser resgatado, então quem
         -- receber a mensagem encaminhada depois não entra na ficha.
         codigo_convite = null
   where id = alvo.id;

  select coalesce(p.nome, '') into vnome
    from public.perfis p where p.id = alvo.nutricionista_id;

  return query select alvo.id, coalesce(vnome, '');
end;
$$;

-- Só quem está autenticado chama. Visitante anônimo não fica tentando
-- códigos no escuro.
revoke all on function public.resgatar_convite(text) from public, anon;
grant execute on function public.resgatar_convite(text) to authenticated;


-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
-- Ligada em TODAS as tabelas. Sem política que permita, nada passa —
-- o padrão do Postgres com RLS ligada é negar.
--
-- Duas formas de acesso:
--
--   1. Nutricionista → tudo (ler, criar, editar, apagar) nas linhas em
--      que `nutricionista_id = auth.uid()`. O `with check` na mesma
--      condição impede criar linha no nome de outro profissional.
--
--   2. Paciente → SÓ LEITURA, e só nas linhas cuja ficha
--      (`pacientes.paciente_id`) tem `usuario_id = auth.uid()`.
--      Isso é o que impede um paciente de ver dados de outro paciente
--      do mesmo nutricionista.
--
-- O `exists (...)` sobre `pacientes` não cria recursão: a política de
-- `pacientes` não consulta nenhuma tabela filha. E ele roda com as
-- permissões de quem está consultando, então a RLS de `pacientes` vale
-- ali dentro também — o paciente só enxerga a própria ficha.

alter table public.perfis          enable row level security;
alter table public.pacientes       enable row level security;
alter table public.consultas       enable row level security;
alter table public.pagamentos      enable row level security;
alter table public.anamneses       enable row level security;
alter table public.avaliacoes      enable row level security;
alter table public.fichas_tecnicas enable row level security;
alter table public.planos          enable row level security;
alter table public.metas           enable row level security;


-- ───────────── perfis ─────────────
-- Cada um enxerga e edita só o próprio perfil. O papel não entra no
-- `update` da aplicação: quem virou nutricionista não vira paciente
-- mudando um campo pelo console do navegador.

drop policy if exists perfis_ler_proprio on public.perfis;
create policy perfis_ler_proprio on public.perfis
  for select using (id = auth.uid());

drop policy if exists perfis_atualizar_proprio on public.perfis;
create policy perfis_atualizar_proprio on public.perfis
  for update using (id = auth.uid()) with check (id = auth.uid());

-- O paciente lê o perfil do profissional que o acompanha — nome e CRN
-- de quem responde pelo prontuário dele não é informação a esconder.
-- Vale só para quem está vinculado: a condição percorre `pacientes`
-- procurando uma ficha em que este perfil é o nutricionista e a conta
-- que consulta é o paciente.
drop policy if exists perfis_paciente_ve_nutricionista on public.perfis;
create policy perfis_paciente_ve_nutricionista on public.perfis
  for select using (
    exists (
      select 1 from public.pacientes p
      where p.nutricionista_id = perfis.id
        and p.usuario_id = auth.uid()
    )
  );

-- Admin vê e aprova/recusa cadastro de qualquer um — é a tela da Fase 2
-- (lista de pendentes) precisando enxergar linha que não é a própria.
--
-- ⚠️ Isto NÃO pode ser um `exists (select 1 from public.perfis ...)`
-- direto dentro da própria política de `perfis`: já tentei e caiu em
-- "infinite recursion detected in policy for relation perfis" — para
-- avaliar a política, o Postgres reavalia as políticas de SELECT de
-- `perfis` de novo dentro da subconsulta, incluindo esta mesma política,
-- ad infinitum. A saída padrão é checar por uma função `security
-- definer`, que roda com privilégio do dono (bypassa RLS só nessa
-- consulta pontual) em vez de reabrir a política.
create or replace function public.eh_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select papel_admin from public.perfis where id = auth.uid()),
    false
  );
$$;

drop policy if exists perfis_admin_le_tudo on public.perfis;
create policy perfis_admin_le_tudo on public.perfis
  for select using (public.eh_admin());

-- A trava de coluna (proteger_campos_privilegiados) já libera admin
-- para mudar status_verificacao — mas ela só entra em ação depois que a
-- linha, como um todo, passar pela política de UPDATE. Sem esta, um
-- admin não passava nem da porta: a política antiga só deixava cada um
-- editar a própria linha.
drop policy if exists perfis_admin_atualiza on public.perfis;
create policy perfis_admin_atualiza on public.perfis
  for update
  using (public.eh_admin())
  with check (public.eh_admin());


-- ───────────── pacientes ─────────────

drop policy if exists pacientes_nutricionista on public.pacientes;
create policy pacientes_nutricionista on public.pacientes
  for all
  using (nutricionista_id = auth.uid())
  with check (nutricionista_id = auth.uid());

-- O paciente lê a própria ficha, mas não edita: dado clínico é do
-- prontuário, quem responde por ele é o profissional.
drop policy if exists pacientes_proprio_ler on public.pacientes;
create policy pacientes_proprio_ler on public.pacientes
  for select using (usuario_id = auth.uid());


-- ───────────── consultas ─────────────

drop policy if exists consultas_nutricionista on public.consultas;
create policy consultas_nutricionista on public.consultas
  for all
  using (nutricionista_id = auth.uid())
  with check (nutricionista_id = auth.uid());

drop policy if exists consultas_paciente_ler on public.consultas;
create policy consultas_paciente_ler on public.consultas
  for select using (
    exists (
      select 1 from public.pacientes p
      where p.id = consultas.paciente_id
        and p.usuario_id = auth.uid()
    )
  );


-- ───────────── pagamentos ─────────────
-- Sem política de leitura para o paciente, de propósito: o financeiro é
-- a contabilidade do consultório, não o extrato do paciente. Se um dia
-- fizer sentido mostrar, entra como decisão própria — não de passagem.

drop policy if exists pagamentos_nutricionista on public.pagamentos;
create policy pagamentos_nutricionista on public.pagamentos
  for all
  using (nutricionista_id = auth.uid())
  with check (nutricionista_id = auth.uid());


-- ───────────── anamneses ─────────────
-- Também sem leitura pelo paciente: a anamnese tem anotação clínica
-- escrita para o profissional, com termos que fora de contexto assustam
-- ou confundem. O que o paciente acompanha é a evolução (avaliacoes).

drop policy if exists anamneses_nutricionista on public.anamneses;
create policy anamneses_nutricionista on public.anamneses
  for all
  using (nutricionista_id = auth.uid())
  with check (nutricionista_id = auth.uid());


-- ───────────── avaliacoes ─────────────
-- Esta o paciente vê: é o "antes e depois" dele, o gráfico de peso,
-- cintura e IMC da própria área.

drop policy if exists avaliacoes_nutricionista on public.avaliacoes;
create policy avaliacoes_nutricionista on public.avaliacoes
  for all
  using (nutricionista_id = auth.uid())
  with check (nutricionista_id = auth.uid());

drop policy if exists avaliacoes_paciente_ler on public.avaliacoes;
create policy avaliacoes_paciente_ler on public.avaliacoes
  for select using (
    exists (
      select 1 from public.pacientes p
      where p.id = avaliacoes.paciente_id
        and p.usuario_id = auth.uid()
    )
  );


-- ───────────── fichas_tecnicas ─────────────
-- Só quando o nutricionista marcar `visivel_paciente`. Ficha em rascunho
-- não vaza.

drop policy if exists fichas_nutricionista on public.fichas_tecnicas;
create policy fichas_nutricionista on public.fichas_tecnicas
  for all
  using (nutricionista_id = auth.uid())
  with check (nutricionista_id = auth.uid());

drop policy if exists fichas_paciente_ler on public.fichas_tecnicas;
create policy fichas_paciente_ler on public.fichas_tecnicas
  for select using (
    visivel_paciente
    and exists (
      select 1 from public.pacientes p
      where p.id = fichas_tecnicas.paciente_id
        and p.usuario_id = auth.uid()
    )
  );


-- ───────────── planos ─────────────

drop policy if exists planos_nutricionista on public.planos;
create policy planos_nutricionista on public.planos
  for all
  using (nutricionista_id = auth.uid())
  with check (nutricionista_id = auth.uid());

drop policy if exists planos_paciente_ler on public.planos;
create policy planos_paciente_ler on public.planos
  for select using (
    visivel_paciente
    and exists (
      select 1 from public.pacientes p
      where p.id = planos.paciente_id
        and p.usuario_id = auth.uid()
    )
  );


-- ───────────── metas ─────────────
-- O paciente lê: é a linha de meta sobreposta ao gráfico de peso dele.

drop policy if exists metas_nutricionista on public.metas;
create policy metas_nutricionista on public.metas
  for all
  using (nutricionista_id = auth.uid())
  with check (nutricionista_id = auth.uid());

drop policy if exists metas_paciente_ler on public.metas;
create policy metas_paciente_ler on public.metas
  for select using (
    exists (
      select 1 from public.pacientes p
      where p.id = metas.paciente_id
        and p.usuario_id = auth.uid()
    )
  );


-- ============================================================
--  Conferência
-- ============================================================
-- Deve listar as 9 tabelas, todas com rls_ligada = true e pelo menos
-- uma política. Qualquer linha com false ou 0 é um vazamento.

select
  c.relname                as tabela,
  c.relrowsecurity         as rls_ligada,
  count(p.polname)         as politicas
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relname;
