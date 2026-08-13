/* ============================================================
   supabase-config.js — endereço e chave pública do projeto

   PREENCHA OS DOIS CAMPOS ABAIXO antes de usar qualquer tela que
   dependa do banco. Onde achar, no painel do supabase.com:

     Project Settings → API
       • Project URL                    → url
       • Publishable key (ou `anon`)    → anonKey

   O Supabase mudou o formato das chaves: projetos novos mostram
   `sb_publishable_...` e projetos antigos mostram a `anon`, que é um
   JWT longo começando em `eyJ`. As duas fazem o mesmo papel e as duas
   funcionam aqui.

   ⚠️ NUNCA a `service_role` nem a `sb_secret_...`: elas ignoram Row
   Level Security, e este arquivo é baixado pelo navegador de qualquer
   visitante do site.

   Não tem problema a chave publishable ficar visível — ela foi feita
   para isso. Quem protege os dados é a Row Level Security do banco
   (supabase/schema.sql), não o segredo da chave.
   ============================================================ */

'use strict';

window.SUPABASE_CONFIG = {
  url: 'https://wxezmcabuuiwixsvkwum.supabase.co',
  anonKey: 'sb_publishable_gH3KXEPoQ---X6GOZX5bSQ_WMgi3_va'
};
