import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const childEditor=readFileSync(new URL('../assets/editor-child-stages.js',import.meta.url),'utf8');
const editor=readFileSync(new URL('../assets/editor-v2.js',import.meta.url),'utf8');

test('child editor resolves parent by stable stage identity or actual stage number',()=>{
  assert.match(childEditor,/const parentId = details\.dataset\.stageId/);
  assert.match(childEditor,/editorData\.stages\.find\(stage =>/);
  assert.match(childEditor,/stage\.stageId === parentId/);
  assert.match(childEditor,/Number\(stage\.number\) === position/);
  assert.doesNotMatch(childEditor,/editorData\.stages\[position\s*-\s*1\]/);
});

test('child stages remain attached by stable parentStageId',()=>{
  assert.match(childEditor,/child\.parentStageId === parent\.stageId/);
  assert.match(childEditor,/if \(parent\?\.stageId\) buildSection\(details, parent\)/);
});

test('single-stage select still renders only one parent without changing data',()=>{
  assert.match(editor,/selected \? \[selected\] : \[\]/);
  assert.match(editor,/data-stage-details="\$\{stage\.number\}"/);
});

test('archived and nonconsecutive numbering must not map by array offset',()=>{
  const stages=[
    {number:1,stageId:'one'},
    {number:3,stageId:'three'},
    {number:5,stageId:'five'},
    {number:11,stageId:'eleven'}
  ];
  for(const [number,id] of [[3,'three'],[11,'eleven']]){
    const stage=stages.find(s=>Number(s.number)===number);
    assert.equal(stage.stageId,id);
    assert.notEqual(stages[number-1]?.stageId,id);
  }
});
