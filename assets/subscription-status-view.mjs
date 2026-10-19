/**
 * Billing display model for Shamatha's student page.
 * Display only: no server-authorized access decision is made here.
 * Production billing is disabled until separately approved.
 */
const LABELS = Object.freeze({
  exempt:'Isento',active:'Ativa',pending:'Pendente',overdue:'Atrasada',
  paused:'Pausada',cancelled:'Cancelada'
});
export function formatSubscriptionState({ exempt = false, subscriptions = [], now = new Date().toISOString() } = {}) {
  if (exempt === true) return { status:'exempt', label:LABELS.exempt, paidThrough:null, message:'Sua conta está isenta de mensalidade.' };
  const records = Array.isArray(subscriptions)
    ? subscriptions.filter(item=>item && item.environment==='production') : [];
  records.sort((a,b)=>Date.parse(b.created_at||'')-Date.parse(a.created_at||''));
  const sub=records[0];
  if (!sub) return { status:'pending', label:LABELS.pending, paidThrough:null, message:'Nenhuma assinatura de produção foi registrada para sua conta.' };
  const end=typeof sub.paid_through==='string'?Date.parse(sub.paid_through):NaN;
  const current=Date.parse(now);
  if (!Number.isFinite(current)) throw new TypeError('Invalid clock for billing display');
  const paidThrough=Number.isFinite(end)?new Date(end).toISOString():null;
  if (sub.access_status==='cancelled') return {status:'cancelled',label:LABELS.cancelled,paidThrough,message:'Assinatura cancelada. Consulte os detalhes antes de regularizar.'};
  if (sub.access_status==='paused') return {status:'paused',label:LABELS.paused,paidThrough,message:'Assinatura pausada. Consulte os detalhes antes de regularizar.'};
  if (paidThrough && end<=current) return {status:'overdue',label:LABELS.overdue,paidThrough,message:'A data registrada do último período pago já passou.'};
  if (sub.access_status==='active' && paidThrough && end>current) {
    return {status:'active',label:LABELS.active,paidThrough,message:'Assinatura registrada como ativa. A liberação do conteúdo depende das regras do servidor.'};
  }
  return {status:'pending',label:LABELS.pending,paidThrough,message:'A assinatura aguarda confirmação ou conciliação de pagamento.'};
}
