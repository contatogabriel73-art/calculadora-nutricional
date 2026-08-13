/* ============================================================
   supabase-config.js — endereço e chave pública do projeto

   PREENCHA OS DOIS CAMPOS ABAIXO antes de usar qualquer tela que
   dependa do banco. Onde achar, no painel do supabase.com:

     Project Settings → API
       • Project URL          → url
       • anon / public key    → anonKey

   ⚠️ SÓ a chave `anon` (também chamada `publishable`) entra aqui.
   NUNCA a `service_role` (ou `secret`): ela ignora Row Level Security
   e este arquivo é servido para qualquer visitante do site.

   Não tem problema a chave `anon` ficar visível — ela foi feita para
   isso. Quem protege os dados é a Row Level Security do banco
   (supabase/schema.sql), não o segredo da chave.
   ============================================================ */

'use strict';

window.SUPABASE_CONFIG = {
  url: '',
  anonKey: ''
};
