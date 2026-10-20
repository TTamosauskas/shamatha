-- Primeiro lote de preservação de contas anteriores à cobrança real.
-- Usar também snapshot final ANTES do go-live: novos cadastros entre este lote
-- e a ativação deverão receber isenção explícita antes do bloqueio financeiro.
-- Apenas billing_exemptions muda; nunca altera profiles nem acesso administrativo.
BEGIN;

INSERT INTO public.billing_exemptions (user_id, reason)
SELECT p.id, 'Cadastro existente antes da ativação da cobrança real - lote inicial 2026-10-19'
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

COMMIT;