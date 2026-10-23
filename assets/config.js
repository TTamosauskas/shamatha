/*
 * Configuração pública do site.
 * A Publishable Key do Supabase foi criada para uso no navegador.
 * Mantenha service_role, secret key e senha de banco fora deste arquivo.
 */
window.SHAMATHA_CONFIG = Object.freeze({
  // Switch ON only after database gate, checkout, and provider verification are validated.
  billingUiEnabled: false,
  billingCheckoutEnabled: false,
  billingReconcileEnabled: false,
  billingCancelEnabled: false,
  baseUrl: 'https://ttamosauskas.github.io/shamatha/',
  supabaseUrl: 'https://zglitbtwzntpchzhrdcy.supabase.co',
  supabasePublishableKey: 'sb_publishable_wgHuzRlFXt2eorcdLHnx7w_8TcAx6EP'
});
