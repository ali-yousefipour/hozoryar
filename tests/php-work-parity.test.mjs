import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dutyForDay, attendanceMetrics, dailyWork, localInstant, allowedShiftTraffic } from '../server/work.js';

const probe=spawnSync('php',['-v'],{encoding:'utf8',timeout:1500});
const hasPhp=probe.status===0;
const phpCode=`require 'php/lib/WorkCalc.php';
$f=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);
echo json_encode(WorkCalc::daily($f['day'],WorkCalc::metrics($f['shift'],$f['day'],$f['parts']),
 WorkCalc::duty($f['shift'],$f['day']),$f['cap'],$f['approved'],$f['holiday'],$f['shift']!==null));`;

const scenarios=[
  {name:'fixed shift with late entry',day:'2026-11-02',kind:'fixed',config:{},start:'08:00',end:'16:00',intervals:[[510,990]]},
  {name:'fixed shift with overtime margins',day:'2026-11-02',kind:'fixed',config:{ot_begin:30,ot_end:30},start:'08:00',end:'16:00',intervals:[[465,1020]]},
  {name:'weekly off-day',day:'2026-11-03',kind:'weekly',config:{days:[1,4]},start:'08:00',end:'16:00',intervals:[]},
  {name:'advanced split shift',day:'2026-11-02',kind:'advanced',config:{weekly:{1:[{s:'08:00',e:'12:00'},{s:'13:00',e:'17:00'}]},ot_begin:30,ot_end:30},intervals:[[465,720],[790,1050]]},
  {name:'overnight rotation',day:'2026-11-05',kind:'rotation_segments',config:{anchor:'2026-11-02',cycle:[{days:2,segments:[{s:'07:00',e:'15:00'}]},{days:1,segments:[]},{days:2,segments:[{s:'23:00',e:'07:00'}]}]},intervals:[[1380,1860]]},
  {name:'Friday exclusive classification',day:'2026-11-06',kind:'fixed',config:{},start:'08:00',end:'16:00',intervals:[[480,960]]},
  {name:'daily leave excuses shortage',day:'2026-11-02',kind:'fixed',config:{},start:'08:00',end:'16:00',intervals:[],approved:[{type:'annual_leave',minutes:480}]},
  {name:'unpaid leave is separate',day:'2026-11-02',kind:'fixed',config:{},start:'08:00',end:'16:00',intervals:[],approved:[{type:'unpaid_leave',minutes:240}]},
];

for(const scenario of scenarios){
  test('PHP calculation parity: '+scenario.name,{skip:!hasPhp},()=>{
    const day=scenario.day,shift={schedule_kind:scenario.kind,schedule_json:JSON.stringify(scenario.config),
      start_time:scenario.start||'08:00',end_time:scenario.end||'16:00',duty_minutes:480,daily_ot_cap:27};
    const parts=scenario.intervals.map(([a,b])=>({start:localInstant(day,a),end:localInstant(day,b)}));
    const config=scenario.config,approved=scenario.approved||[],holiday=false;
    const js=dailyWork({day,...attendanceMetrics(shift,day,parts,config),duty:dutyForDay(shift,day),
      overtimeCap:27,hasShift:true,approved,holiday});
    const php=spawnSync('php',['-r',phpCode],{encoding:'utf8',input:JSON.stringify({day,shift,
      parts:parts.map(p=>[Math.round(p.start/1000),Math.round(p.end/1000)]),cap:27,approved,holiday}),timeout:5000});
    assert.equal(php.status,0,php.stderr);
    const result=JSON.parse(php.stdout);
    assert.deepEqual(result,js);
  });
}

for(const scenario of [
  {name:'fixed start in-window',kind:'fixed',date:'2026-11-02',at:450,action:'in'},
  {name:'fixed start out-of-window',kind:'fixed',date:'2026-11-02',at:600,action:'in'},
  {name:'overnight checkout next morning',kind:'fixed',date:'2026-11-02',start:'22:00',end:'06:00',at:1770,action:'out'},
  {name:'weekly rest day',kind:'weekly',config:{days:[1,3]},date:'2026-11-03',at:480,action:'in'},
  {name:'advanced segmented end',kind:'advanced',config:{weekly:{1:[{s:'08:00',e:'11:00'},{s:'14:00',e:'18:00'}]}},date:'2026-11-02',at:1085,action:'out'},
  {name:'floating unrestricted',kind:'floating',date:'2026-11-02',at:120,action:'out'},
  {name:'missing assignment rejects',kind:null,date:'2026-11-02',at:480,action:'in'},
]){
  test('PHP shift gate parity: '+scenario.name,{skip:!hasPhp},()=>{
    const shift=scenario.kind?{schedule_kind:scenario.kind,schedule_json:JSON.stringify(scenario.config||{}),
      start_time:scenario.start||'08:00',end_time:scenario.end||'16:00',duty_minutes:480}:null;
    const at=localInstant(scenario.date,scenario.at);
    const js=allowedShiftTraffic(shift,at,scenario.action);
    const php=spawnSync('php',['-r',`require 'php/lib/WorkCalc.php';
      $f=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);
      echo json_encode(WorkCalc::allowedShiftTraffic($f['shift'],$f['at'],$f['action']));`],
      {encoding:'utf8',input:JSON.stringify({shift,at:Math.floor(at/1000),action:scenario.action}),timeout:5000});
    assert.equal(php.status,0,php.stderr);
    assert.equal(JSON.parse(php.stdout),js);
  });
}

test('PHP XLSX contains RTL worksheet, purple title and duration format',{skip:!hasPhp},()=>{
  const php=spawnSync('php',['-r',`require 'php/lib/XlsxExport.php';
    $bytes=XlsxExport::bytes(['month'=>'2026-10','reports'=>[['name'=>'کارمند نمونه','role'=>'employee','report'=>['totals'=>['worked'=>480]]]]]);
    $p=tempnam(sys_get_temp_dir(),'xlsx_check_');file_put_contents($p,$bytes);
    $zip=new ZipArchive();$open=$zip->open($p);$sheet=$zip->getFromName('xl/worksheets/sheet1.xml');
    $styles=$zip->getFromName('xl/styles.xml');$zip->close();unlink($p);
    echo json_encode(['open'=>$open===true,'rtl'=>str_contains($sheet,'rightToLeft="1"'),
      'name'=>str_contains($sheet,'کارمند نمونه'),'purple'=>str_contains($styles,'FF6D28D9'),
      'duration'=>str_contains($styles,'[h]:mm'),'bytes'=>strlen($bytes)]);`],
    {encoding:'utf8',timeout:5000});
  assert.equal(php.status,0,php.stderr);
  assert.deepEqual(JSON.parse(php.stdout).open,true);
  const result=JSON.parse(php.stdout);
  assert.equal(result.rtl,true);assert.equal(result.name,true);assert.equal(result.purple,true);
  assert.equal(result.duration,true);assert.ok(result.bytes>1000);
});
