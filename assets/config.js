/*
 * Configuração pública do site.
 * A Publishable Key do Supabase foi criada para uso no navegador.
 * Mantenha service_role, secret key e senha de banco fora deste arquivo.
 */
window.SHAMATHA_CONFIG = Object.freeze({
  // Prepared for full activation. These values expose UI only; the server must
  // still verify user/terms, seller, payment and three private go-live secrets.
  billingUiEnabled: true,
  billingCheckoutEnabled: true,
  billingReconcileEnabled: true,
  billingCancelEnabled: true,
  baseUrl: 'https://ttamosauskas.github.io/shamatha/',
  supabaseUrl: 'https://zglitbtwzntpchzhrdcy.supabase.co',
  supabasePublishableKey: 'sb_publishable_wgHuzRlFXt2eorcdLHnx7w_8TcAx6EP'
});
