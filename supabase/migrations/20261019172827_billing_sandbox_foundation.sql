-- Shamatha / Mercado Pago: estruturas preparatórias.
-- Nao altera profiles, progresso, politicas existentes ou acesso dos alunos.
-- NAO habilita cobranca nem preenche automaticamente assinaturas.
-- A isencao dos usuarios antigos sera materializada na ativacao futura, sob revisao.
BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_exemptions (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'Usuario anterior a ativacao',
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mp_preapproval_id text NOT NULL UNIQUE,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
  provider_status text NOT NULL DEFAULT 'pending',
  access_status text NOT NULL DEFAULT 'pending'
    CHECK (access_status IN ('pending','active','overdue','cancelled','paused')),
  amount_cents integer NOT NULL DEFAULT 18000 CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  paid_through timestamptz,
  next_payment_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_paid_through_only_after_payment
    CHECK (paid_through IS NULL OR paid_through >= created_at - interval '1 day')
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_user_idx
  ON public.billing_subscriptions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.billing_subscriptions(id) ON DELETE CASCADE,
  mp_payment_id text UNIQUE,
  mp_authorized_payment_id text UNIQUE,
  provider_status text NOT NULL DEFAULT 'pending',
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  period_start timestamptz,
  period_end timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_payments_subscription_idx
  ON public.billing_payments (subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  event_type text,
  provider_resource_id text,
  payload jsonb,
  processing_status text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- Separado das assinaturas reais: dados exclusivamente da homologacao.
CREATE TABLE IF NOT EXISTS public.billing_sandbox_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  editor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payer_email text NOT NULL,
  mp_preapproval_id text UNIQUE,
  checkout_url text,
  state text NOT NULL DEFAULT 'creating'
    CHECK (state IN ('creating','created','needs_review')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (editor_id, payer_email)
);

ALTER TABLE public.billing_exemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_sandbox_attempts ENABLE ROW LEVEL SECURITY;

-- Leituras por quem e titular ou editor. Escritas apenas pela integracao servidora
-- (service_role bypass RLS). Sem policies de INSERT/UPDATE/DELETE para o cliente.
CREATE POLICY billing_exemptions_read ON public.billing_exemptions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR (select private.is_editor()));

CREATE POLICY billing_subscriptions_read ON public.billing_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) OR (select private.is_editor()));

CREATE POLICY billing_payments_read ON public.billing_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.billing_subscriptions s
            WHERE s.id = subscription_id
              AND (s.user_id = (select auth.uid()) OR (select private.is_editor())))
  );

-- Nao ha policies para webhook_events ou sandbox_attempts:
-- nem mesmo alunos autenticados podem ler segredos, payloads ou links de testes.

COMMENT ON TABLE public.billing_exemptions IS 'Isencoes futuras; preencher antes de ativar controle financeiro.';
COMMENT ON TABLE public.billing_sandbox_attempts IS 'Somente homologacao, sem impacto em perfis e autorizacoes.';

COMMIT;
