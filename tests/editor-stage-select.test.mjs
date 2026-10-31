import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('editor.html');
const editor=read('assets/editor-v2.js');
const dynamic=read('assets/editor-dynamic-stages.js');
const structure=read('assets/editor-stage-structure.js');

const start=editor.indexOf('let selectedEditorStageId = null;');
const end=editor.indexOf("\n$('inviteForm').addEventListener",start);
assert.ok(start>0&&end>start,'The editor selection controller must be available');
const controller=editor.slice(start,end);

function stage(id,number,name) {
  return {
    stageId:id,number,unitName:name,
    stageName:name,objective:'',sessionsRequired:3,
    deadlineDays:7,videoUrl:'',videoLimitSeconds:0,
    audioUrl:'',audioPath:''
  };
}

function createHarness(initial=[]) {
  let markup='',choiceMarkup='';
  const events={};
  const root={
    addEventListener(name,fn){events['root:'+name]=fn},
    set innerHTML(v){markup=v},
    get innerHTML(){return markup}
  };
  const select={
    value:'',disabled:true,options:[],
    set innerHTML(v){
      choiceMarkup=v;
      this.options=[...v.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
        .map(m=>({value:m[1],textContent:m[2]}));
    },
    get innerHTML(){return choiceMarkup},
    addEventListener(name,fn){events['select:'+name]=fn}
  };
  const empty={hidden:false};
  const nodes={stages:root,editorStageSelect:select,stageEmptyState:empty};
  const editorData={stages:initial};
  const state={dirty:false,saving:false,confirm:true,confirmCount:0};
  const document={
    querySelector(selector){
      if(selector.includes('data-saving'))return state.saving?{}:null;
      if(selector.includes('data-dirty'))return state.dirty?{}:null;
      return null;
    },
    querySelectorAll(){return[]}
  };
  const window={confirm(){state.confirmCount++;return state.confirm}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const fn=new Function('$','document','window','editorData','esc','audioBlock',
    'GLOBAL_MIN_SESSION_SECONDS','api',
    controller+'\nreturn {renderStages,getSelected:()=>selectedEditorStageId};');
  const ui=fn(id=>nodes[id],document,window,editorData,esc,()=>'',300,()=>{});
  function choose(id){
    select.value=id;
    events['select:change']({currentTarget:select});
  }
  return {root,select,empty,events,editorData,state,...ui,choose};
}

test('editor has a real labeled selector, default placeholder, and empty stage editor',()=>{
  assert.match(html,/<label for="editorStageSelect">Selecione a etapa para editar<\/label>/);
  assert.match(html,/<select id="editorStageSelect" aria-controls="stages" disabled>/);
  assert.match(html,/<option value="">Selecione uma etapa\.\.\.<\/option>/);
  assert.match(html,/id="stageEmptyState"/);
  const x=createHarness([stage('stage-one',1,'Respiração'),stage('stage-two',2,'Concentração')]);
  x.renderStages();
  assert.equal(x.root.innerHTML,'');
  assert.equal(x.empty.hidden,false);
  assert.equal(x.select.value,'');
  assert.equal(x.select.disabled,false);
  assert.equal(x.select.options.length,3);
});

test('selecting a stage only creates its own form, not all stage forms',()=>{
  const x=createHarness([stage('stage-one',1,'Respiração'),stage('stage-two',2,'Concentração'),stage('stage-three',3,'Calma')]);
  x.renderStages();
  x.choose('stage-two');
  assert.equal(x.empty.hidden,true);
  assert.equal(x.select.value,'stage-two');
  assert.equal((x.root.innerHTML.match(/class="details-body stage-form"/g)||[]).length,1);
  assert.match(x.root.innerHTML,/data-stage-details="2"/);
  assert.doesNotMatch(x.root.innerHTML,/data-stage-details="1"/);
  assert.doesNotMatch(x.root.innerHTML,/data-stage-details="3"/);
});

test('selected stage remains selected by stable ID when stages are renumbered',()=>{
  const x=createHarness([stage('stage-one',1,'Primeira'),stage('stage-two',2,'Segunda')]);
  x.renderStages(2);
  assert.equal(x.select.value,'stage-two');
  x.editorData.stages=[stage('stage-two',1,'Segunda'),stage('stage-one',2,'Primeira')];
  x.renderStages();
  assert.equal(x.select.value,'stage-two');
  assert.match(x.root.innerHTML,/data-stage-details="1"/);
  assert.doesNotMatch(x.root.innerHTML,/data-stage-details="2"/);
});

test('added stage is selected immediately, and removed selection becomes empty',()=>{
  const x=createHarness([stage('stage-one',1,'Primeira')]);
  x.renderStages();
  x.editorData.stages.push(stage('stage-two',2,'Segunda'));
  x.renderStages(2);
  assert.equal(x.getSelected(),'stage-two');
  assert.equal(x.select.options.length,3);
  x.editorData.stages=[stage('stage-one',1,'Primeira')];
  x.renderStages();
  assert.equal(x.select.value,'');
  assert.equal(x.root.innerHTML,'');
  assert.equal(x.empty.hidden,false);
});

test('unsaved changes in parent or child are not discarded silently',()=>{
  const x=createHarness([stage('stage-one',1,'Primeira'),stage('stage-two',2,'Segunda')]);
  x.renderStages(1);
  x.events['root:input']({target:{closest(){return{dataset:{dirty:'false'}}}}});
  x.state.dirty=true;
  x.state.confirm=false;
  x.choose('stage-two');
  assert.equal(x.select.value,'stage-one');
  assert.equal(x.getSelected(),'stage-one');
  assert.equal(x.state.confirmCount,1);
  x.state.confirm=true;
  x.choose('stage-two');
  assert.equal(x.select.value,'stage-two');
});

test('stage selection is blocked while a parent form is saving',()=>{
  const x=createHarness([stage('stage-one',1,'Primeira'),stage('stage-two',2,'Segunda')]);
  x.renderStages(1);
  x.state.saving=true;
  x.choose('stage-two');
  assert.equal(x.select.value,'stage-one');
  assert.equal(x.state.confirmCount,0);
});

test('stage titles are escaped in selector to prevent injecting markup',()=>{
  const x=createHarness([stage('one',1,'<img src=x onerror=alert(1)> & nome')]);
  x.renderStages();
  assert.match(x.select.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt; &amp; nome/);
});

test('stage count is derived from all active stages, not rendered details',()=>{
  assert.match(dynamic,/editorData\.stages\.length/);
  assert.doesNotMatch(dynamic,/return root\.querySelectorAll\('\[data-stage-details\]'\)\.length/);
  assert.match(dynamic,/renderStages\(data\.stage\.number\)/);
});

test('reordering and archive controls remain available for the one selected stage',()=>{
  assert.match(structure,/class="btn secondary small stage-order-btn move-stage-up"/);
  assert.match(structure,/class="btn secondary small stage-order-btn move-stage-down"/);
  assert.match(structure,/class="btn danger small stage-remove-btn"/);
  assert.match(structure,/renderStages\(openStage\)/);
  assert.match(structure,/renderArchived\(\)/);
  assert.match(structure,/confirmStageEditorDiscard/);
  assert.doesNotMatch(structure,/title="Arraste para reordenar"/);
});

test('editor loads fresh stage selector scripts and keeps child stages intact',()=>{
  for(const file of ['editor-v2.js','editor-dynamic-stages.js','editor-stage-structure.js'])
    assert.match(html,new RegExp('assets/'+file.replaceAll('.','\\.')+'\\?v=20261031-single-stage1'));
  assert.match(html,/assets\/editor-child-stages\.js/);
  assert.match(html,/id="archivedStagesSection"/);
  assert.match(editor,/choice\.textContent = `Etapa \$\{number\}/);
});

test('editor code parses',()=>{
  assert.doesNotThrow(()=>new Function(editor));
  assert.doesNotThrow(()=>new Function(dynamic));
  assert.doesNotThrow(()=>new Function(structure));
});
