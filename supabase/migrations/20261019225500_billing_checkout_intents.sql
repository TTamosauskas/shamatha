-- Preparação para checkout de alunos: SEM habilitação de cobrança ou RLS de conteúdo.
-- Esta tabela existe apenas para reservar UMA tentativa aberta por aluno e ambiente.
-- A criação no Mercado Pago permanece DESLIGADA; função ainda não publicada.
BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  state text NOT NULL DEFAULT 'creating'
    CHECK (state IN ('creating','created','needs_review','cancelled','expired')),
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  mp_preapproval_id text UNIQUE,
  checkout_url text,
  seller_id text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_one_open_per_user_env_idx
  ON public.billing_checkout_intents(user_id, environment)
  WHERE state IN ('creating','created','needs_review');

CREATE INDEX IF NOT EXISTS billing_checkout_intents_user_idx
  ON public.billing_checkout_intents(user_id, created_at DESC);

ALTER TABLE public.billing_checkout_intents ENABLE ROW LEVEL SECURITY;

-- NENHUMA policy de cliente: somente Supabase Edge Function autenticada
-- pode reservar/alterar a tabela através do papel de serviço.
COMMENT ON TABLE public.billing_checkout_intents IS
  'Reservas idempotentes de checkout de assinaturas; preparatório; sem bloqueio financeiro e sem cobranças habilitadas.';

COMMIT;