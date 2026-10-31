(() => {
  'use strict';
  const base = window.ShamathaBackend;
  if (!base?.request || !base?.getClient) return;
  const sb = base.getClient();
  const originalRequest = base.request.bind(base);
  const BUCKET = 'shamatha-support-materials';
  const MAX_BYTES = 20 * 1024 * 1024;
  const types = Object.freeze({
    pdf:'application/pdf',
    doc:'application/msword',
    docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',
    gif:'image/gif',webp:'image/webp'
  });
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const pathPattern = new RegExp('^stage-'+uuid+'/'+uuid+'\\.(pdf|doc|docx|jpg|jpeg|png|gif|webp)$','i');

  function failure(message) { throw new Error(message); }
  function materialInfo(file) {
    if (!file || typeof file.name !== 'string' ||
        !Number.isFinite(file.size) || file.size < 1 || file.size > MAX_BYTES)
      failure('Selecione um arquivo válido de até 20 MB.');
    const match = /\.([a-z0-9]+)$/i.exec(file.name.trim());
    const ext = String(match?.[1] || '').toLowerCase();
    const mime = types[ext];
    if (!mime || (file.type && file.type.toLowerCase() !== mime))
      failure('Aceitos apenas PDF, DOC, DOCX, JPG, PNG, GIF e WEBP.');
    const filename = String(file.name).split(/[\\/]/).pop()
      .replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
    return {ext,mime,filename:filename || ('material.' + ext)};
  }
  async function stageFor(path) {
    const root = /^\/api\/editor\/stages\/(\d+)\/material$/.exec(path);
    const child = /^\/api\/editor\/child-stages\/([0-9a-f-]{36})\/material$/i.exec(path);
    if (!root && !child) return null;
    let query = sb.from('stages')
      .select('stage_id,parent_stage_id,material_path,material_name');
    if (root) {
      const n = Number(root[1]);
      if (!Number.isSafeInteger(n) || n < 1) failure('Etapa inválida.');
      query = query.eq('position', n).is('parent_stage_id', null).eq('is_active',true);
    } else query = query.eq('stage_id', child[1]).not('parent_stage_id','is',null);
    const {data,error} = await query.maybeSingle();
    if (error || !data?.stage_id) failure('Etapa não localizada ou sem permissão.');
    return {row:data,root:Number(root?.[1]||0),child:Boolean(child)};
  }
  async function refreshResult(stage) {
    const data = await originalRequest('/api/editor/data');
    if(stage.child) {
      const childStage = data.childStages?.find(c=>c.stageId===stage.row.stage_id);
      if (!childStage) failure('Arquivo salvo. Atualize a página para ver a etapa filha.');
      return {childStage};
    }
    const parent = data.stages?.find(s=>s.stageId===stage.row.stage_id);
    if (!parent) failure('Arquivo salvo. Atualize a página para ver a etapa.');
    return {stage:parent};
  }
  async function upload(stage, file) {
    const info = materialInfo(file);
    const token = crypto.randomUUID();
    const objectPath = 'stage-'+stage.row.stage_id+'/'+token+'.'+info.ext;
    const result = await sb.storage.from(BUCKET).upload(objectPath,file,{
      upsert:false,cacheControl:'60',contentType:info.mime
    });
    if(result.error) failure('Não foi possível enviar o material: '+result.error.message);
    const saved = await sb.from('stages').update({
      material_path:objectPath,material_name:info.filename,
      updated_at:new Date().toISOString()
    }).eq('stage_id',stage.row.stage_id).select('stage_id').maybeSingle();
    if(saved.error || !saved.data) {
      await sb.storage.from(BUCKET).remove([objectPath]).catch(()=>null);
      failure('O material foi enviado, mas não pôde ser associado à etapa.');
    }
    if(stage.row.material_path && stage.row.material_path !== objectPath)
      await sb.storage.from(BUCKET).remove([stage.row.material_path]).catch(()=>null);
    return refreshResult(stage);
  }
  async function remove(stage) {
    const saved=await sb.from('stages').update({
      material_path:'',material_name:'',updated_at:new Date().toISOString()
    }).eq('stage_id',stage.row.stage_id).select('stage_id').maybeSingle();
    if(saved.error || !saved.data) failure('Não foi possível remover o material.');
    if(stage.row.material_path)
      await sb.storage.from(BUCKET).remove([stage.row.material_path]).catch(()=>null);
    return refreshResult(stage);
  }
  async function request(path,options={}) {
    const method=String(options.method||'GET').toUpperCase();
    if(method!=='POST' && method!=='DELETE')return originalRequest(path,options);
    const stage=await stageFor(path);
    if(!stage)return originalRequest(path,options);
    if(method==='DELETE')return remove(stage);
    return upload(stage,options.body?.file);
  }
  async function download(path,filename) {
    if(typeof path!=='string' || !pathPattern.test(path)) failure('Material inválido.');
    const name=String(filename||'material').split(/[\\/]/).pop()
      .replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180)||'material';
    // Authenticated download enforces Storage RLS at the time of the click.
    // Do NOT expose a public URL or a long-lived signed URL.
    const {data,error}=await sb.storage.from(BUCKET).download(path);
    if(error || !data) failure('Não foi possível baixar o material. Confira seu acesso e tente novamente.');
    const objectUrl=URL.createObjectURL(data);
    try {
      const anchor=document.createElement('a');
      anchor.href=objectUrl;
      anchor.download=name;
      anchor.style.display='none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
    }
  }
  window.ShamathaSupportMaterials=Object.freeze({download});
  window.ShamathaBackend=Object.freeze({...base,request});
})();
