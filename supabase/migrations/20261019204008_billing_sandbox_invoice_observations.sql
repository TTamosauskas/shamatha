-- Homologacao Mercado Pago: observacoes auditaveis de faturas; sem impacto no acesso.
-- Nao acrescentar policy para clientes: somente funcoes server-side com service_role.
BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_sandbox_invoice_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.billing_sandbox_attempts(id) ON DELETE CASCADE,
  mp_invoice_id text NOT NULL UNIQUE,
  mp_payment_id text,
  invoice_status text NOT NULL,
  payment_status text,
  payment_approved_verified boolean NOT NULL DEFAULT false,
  amount_cents integer NOT NULL CHECK (amount_cents = 18000),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  debit_date timestamptz,
  payment_approved_at timestamptz,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_sandbox_invoice_attempt_idx
  ON public.billing_sandbox_invoice_observations (attempt_id, debit_date DESC);

ALTER TABLE public.billing_sandbox_invoice_observations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.billing_sandbox_attempts
  ADD COLUMN IF NOT EXISTS last_provider_status text,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;

COMMENT ON TABLE public.billing_sandbox_invoice_observations IS
  'Faturas verificadas da conta Mercado Pago de TESTE; nao concedem acesso nem sao faturas de producao. Sem politicas cliente.';
COMMIT;