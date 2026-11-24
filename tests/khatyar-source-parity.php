<?php
declare(strict_types=1);
// Read-only optional comparison against a user-owned local Khatyar checkout.
if(PHP_SAPI!=='cli')exit(1);
$source=$argv[1]??'';
if(!is_file($source.'/php/lib/ShiftCalc.php')){fwrite(STDERR,"Pass the local Khatyar checkout path.\n");exit(1);}
require $source.'/php/lib/ShiftCalc.php';
require dirname(__DIR__).'/php/lib/WorkCalc.php';
date_default_timezone_set('Asia/Tehran');
$cases=[['08:00','16:00'],['22:00','06:00'],['23:00','07:00'],['21:30','23:30'],['05:00','08:00'],['00:00','00:01']];
$count=0;
foreach($cases as [$start,$end]){
    $day='2026-11-23';$in=strtotime("$day $start");$out=strtotime("$day $end");if($out<=$in)$out+=86400;
    $shift=['schedule_kind'=>'fixed','schedule_json'=>'{}','start_time'=>$start,'end_time'=>$end,'duty_minutes'=>($out-$in)/60];
    $metrics=WorkCalc::metrics($shift,$day,[[$in,$out]]);
    foreach(['night'=>ShiftCalc::nightMinutes($in,$out),'in_shift'=>ShiftCalc::segmentLength(['s'=>$start,'e'=>$end])] as $key=>$expected){
        if($metrics[$key]!==$expected){fwrite(STDERR,"Mismatch $start/$end $key\n");exit(1);} $count++;
    }
}
echo json_encode(['ok'=>true,'comparisons'=>$count,'scope'=>'night minutes and segment duration only'],JSON_UNESCAPED_SLASHES)."\n";
