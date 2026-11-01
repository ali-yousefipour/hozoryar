import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { archivedWorkXlsx } from '../server/xlsx.js';

test('archived monthly report exports a valid RTL styled XLSX with duration cells',()=>{
  const data=archivedWorkXlsx({month:'j-1405-07',reports:[{name:'نیروی <نمونه>',role:'employee',report:{totals:{worked:510,shortage:30,absence:0}}}]});
  assert.equal(data.readUInt32LE(0),0x04034b50);
  const folder=mkdtempSync(join(tmpdir(),'hozoryar-xlsx-'));
  try{
    const path=join(folder,'report.xlsx');writeFileSync(path,data);
    const check=spawnSync('unzip',['-t',path],{encoding:'utf8'});
    assert.equal(check.status,0,check.stdout+check.stderr);
    const xml=spawnSync('unzip',['-p',path,'xl/worksheets/sheet1.xml'],{encoding:'utf8'});
    assert.equal(xml.status,0);
    assert.match(xml.stdout,/rightToLeft="1"/);
    assert.match(xml.stdout,/نیروی &lt;نمونه&gt;/);
    assert.match(xml.stdout,/حضور کل/);
    assert.doesNotMatch(xml.stdout,/<f>/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
