import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const migration=read('supabase/migrations/20261031180000_stage_support_materials.sql');
const childUnlockPolicy=read('supabase/migrations/20261031183000_support_material_child_unlock.sql');
const helper=read('assets/support-material-backend.js');
const parent=read('assets/editor-v2.js');
const child=read('assets/editor-child-stages.js');
const app=read('assets/app.js');
const context=read('assets/child-practice-context.js');
const fast=read('assets/fast-app-data.js');
const childBackend=read('assets/child-stages-backend.js');
const main=read('assets/stage-identity.js');

function harness({editor=true}={}){
  const calls={uploads:[],downloads:[],removes:[],updates:[],requests:[]};
  const stages=[
    {stage_id:'11111111-1111-4111-8111-111111111111',parent_stage_id:null,
      position:1,material_path:'',material_name:''},
    {stage_id:'22222222-2222-4222-8222-222222222222',
      parent_stage_id:'11111111-1111-4111-8111-111111111111',
      material_path:'',material_name:''}
  ];
  const fileStorage={
    async upload(path,file,options){calls.uploads.push({path,file,options});return{error:null}},
    async remove(paths){calls.removes.push(paths);return{error:null}},
    async download(path){calls.downloads.push(path);return{data:new Blob(['ok']),error:null}}
  };
  const sb={
    storage:{from(bucket){assert.equal(bucket,'shamatha-support-materials');return fileStorage}},
    from(table){
      assert.equal(table,'stages');
      let stageFilter=null,position=null,parentMode=null,selectOne=false;
      const q={
        select(){return q},
        eq(field,value){
          if(field==='stage_id')stageFilter=value;
          if(field==='position')position=value;
          return q;
        },
        is(field,value){if(field==='parent_stage_id'&&value===null)parentMode='root';return q},
        not(field){if(field==='parent_stage_id')parentMode='child';return q},
        maybeSingle(){const row=stages.find(row=>
          (!stageFilter||row.stage_id===stageFilter)&&
          (!position||row.position===position)&&
          (!parentMode||(parentMode==='root'?!row.parent_stage_id:!!row.parent_stage_id))
        );return Promise.resolve({data:row?{...row}:null,error:null});},
        update(body){
          calls.updates.push(body);
          return {
            eq(field,value){
              const row=stages.find(x=>x.stage_id===value);
              return {select(){return {async maybeSingle(){
                if(row)Object.assign(row,body);
                return {data:row?{stage_id:row.stage_id}:null,error:null};
              }}}};
            }
          };
        }
      };
      return q;
    }
  };
  const fakeBackend={
    getClient(){return sb},
    async request(path){
      calls.requests.push(path);
      if(path==='/api/editor/data')return{
        stages:[{stageId:stages[0].stage_id,number:1,
          materialPath:stages[0].material_path,materialName:stages[0].material_name}],
        childStages:[{stageId:stages[1].stage_id,
          materialPath:stages[1].material_path,materialName:stages[1].material_name}]
      };
      return {unhandled:true};
    }
  };
  const clicks=[];
  const blobs=[];
  const document={
    createElement(){return{
      style:{},
      click(){clicks.push({href:this.href,download:this.download})},
      remove(){}
    }},
    body:{appendChild(){}}
  };
  const context={
    window:{ShamathaBackend:fakeBackend},
    crypto:{randomUUID(){return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}},
    document,Blob,URL:{
      createObjectURL(blob){blobs.push(blob);return'blob:test'},
      revokeObjectURL(){}
    },
    setTimeout(fn){fn()}
  };
  vm.runInNewContext(helper,context);
  return {api:context.window.ShamathaBackend.request,
    download:context.window.ShamathaSupportMaterials.download,
    calls,stages,clicks,blobs};
}
const pdf=(name='guia.pdf',size=128,type='application/pdf')=>({name,size,type});

test('private bucket, two metadata columns, and editor-only upload policy',()=>{
  assert.match(migration,/material_path text not null default ''/);
  assert.match(migration,/material_name text not null default ''/);
  assert.match(migration,/shamatha-support-materials',false,20971520/);
  assert.match(migration,/on storage\.objects for insert to authenticated/);
  assert.match(migration,/private\.is_editor\(\)/);
  assert.match(migration,/on storage\.objects for select to authenticated/);
  assert.match(migration,/private\.has_content_access\(\)/);
  assert.match(migration,/s\.material_path=storage\.objects\.name/);
  assert.doesNotMatch(migration,/on storage\.objects for select to public/);
});

test('child lesson files also require the recorded release unlock',()=>{
  assert.match(childUnlockPolicy,/s\.material_path=storage\.objects\.name/);
  assert.match(childUnlockPolicy,/s\.is_active=true/);
  assert.match(childUnlockPolicy,/s\.parent_stage_id is null/);
  assert.match(childUnlockPolicy,/p\.data->'childUnlocks'/);
  assert.match(childUnlockPolicy,/s\.stage_id::text/);
  assert.match(childUnlockPolicy,/private\.has_content_access/);
});

test('uploading PDF associates file only with the selected principal stage',async()=>{
  const h=harness();
  const result=await h.api('/api/editor/stages/1/material',{method:'POST',body:{file:pdf()}});
  assert.equal(h.calls.uploads.length,1);
  assert.match(h.calls.uploads[0].path,/^stage-11111111-1111-4111-8111-111111111111\//);
  assert.equal(h.calls.uploads[0].options.contentType,'application/pdf');
  assert.equal(h.calls.uploads[0].options.upsert,false);
  assert.equal(result.stage.materialName,'guia.pdf');
  assert.equal(h.stages[1].material_path,'');
});

test('child upload never overwrites parent material',async()=>{
  const h=harness();
  const result=await h.api('/api/editor/child-stages/22222222-2222-4222-8222-222222222222/material',
    {method:'POST',body:{file:pdf('aula-filho.pdf')}});
  assert.equal(result.childStage.materialName,'aula-filho.pdf');
  assert.equal(h.stages[0].material_path,'');
  assert.equal(h.calls.uploads.length,1);
});

test('reject empty, oversized and unsafe file types before upload',async()=>{
  const h=harness();
  for(const file of [
    pdf('empty.pdf',0),pdf('large.pdf',20*1024*1024+1),
    pdf('script.html'),pdf('malware.svg'),
    pdf('fake.pdf',128,'text/html'),
    pdf('macro.docm',128,'application/vnd.ms-word.document.macroEnabled.12')
  ])await assert.rejects(h.api('/api/editor/stages/1/material',{
    method:'POST',body:{file}
  }));
  assert.equal(h.calls.uploads.length,0);
});

test('Word documents and all permitted images can be sent',async()=>{
  for(const [name,mime] of [
    ['guia.doc','application/msword'],
    ['guia.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['capa.jpg','image/jpeg'],['capa.jpeg','image/jpeg'],
    ['ilustracao.png','image/png'],['animacao.gif','image/gif'],
    ['arte.webp','image/webp']
  ]){
    const h=harness();
    await h.api('/api/editor/stages/1/material',{method:'POST',
      body:{file:pdf(name,128,mime)}});
    assert.equal(h.calls.uploads.length,1,name);
  }
});

test('removing material clears stage metadata and deletes only old object',async()=>{
  const h=harness();
  await h.api('/api/editor/stages/1/material',{method:'POST',body:{file:pdf()}});
  assert.equal(h.calls.uploads.length,1);
  assert.equal(h.calls.removes.length,0,'Newly uploaded object must not be removed');
  await h.api('/api/editor/stages/1/material',{method:'DELETE'});
  assert.equal(h.stages[0].material_path,'');
  assert.equal(h.stages[0].material_name,'');
  assert.equal(h.calls.removes.length,1);
  assert.equal(h.calls.removes[0][0],h.calls.uploads[0].path);
});

test('download is an authenticated blob fetch, not a public or signed URL',async()=>{
  const h=harness();
  const path='stage-11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf';
  await h.download(path,'Caderno.pdf');
  assert.deepEqual(h.calls.downloads,[path]);
  assert.equal(h.clicks[0].download,'Caderno.pdf');
  assert.equal(h.clicks[0].href,'blob:test');
  await assert.rejects(h.download('https://example.com/file.pdf','file.pdf'));
  await assert.rejects(h.download('../other.pdf','file.pdf'));
  assert.equal(h.calls.downloads.length,1);
});

test('editor inputs render after audio in root and child stages',()=>{
  assert.match(parent,/\$\{audioBlock\(stage\)\}\s*\$\{supportMaterialBlock\(stage\)\}/);
  assert.match(child,/<label>Material de Apoio \(opcional\)<\/label>/);
  assert.match(child,/name="childMaterialFile"/);
  assert.match(parent,/class="material-file"/);
  assert.match(child,/upload-child-material/);
  assert.match(child,/remove-child-material/);
});

test('both main and child stage data carry distinct file metadata',()=>{
  for(const code of [fast,main,childBackend,context])
    assert.match(code,/materialPath:/);
  assert.match(context,/materialPath:child\.materialPath \|\| ''/);
  assert.match(fast,/materialName:row\.material_name/);
});

test('lesson intro displays file name after video with click-time entitlement download',()=>{
  assert.match(app,/\$\{mediaMarkup\(cfg\.videoUrl, cfg\.videoLimitSeconds\)\}\$\{supportMaterialMarkup\(cfg\)\}/);
  assert.match(app,/Material de Apoio:/);
  assert.match(app,/escapeHtml\(cfg\.materialName\)/);
  assert.match(app,/ShamathaSupportMaterials\.download\(cfg\.materialPath,cfg\.materialName\)/);
  assert.doesNotMatch(app,/getPublicUrl\(/);
});

test('script parses and HTML loads same backend on editor and student pages',()=>{
  assert.doesNotThrow(()=>new Function(helper));
  assert.doesNotThrow(()=>new Function(app));
  assert.doesNotThrow(()=>new Function(parent));
  assert.doesNotThrow(()=>new Function(child));
  const editorHtml=read('editor.html'),appHtml=read('app.html');
  for(const page of [editorHtml,appHtml])
    assert.match(page,/support-material-backend\.js\?v=20261031-material1/);
});
