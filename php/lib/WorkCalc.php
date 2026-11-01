<?php
declare(strict_types=1);
require_once __DIR__ . '/CalendarApi.php';

// Pure reporting primitives; does not query the database or depend on request identity.
final class WorkCalc {
    private static function config(?array $shift): array {
        if(!$shift)return [];
        $json=json_decode($shift['schedule_json']??'{}',true);
        return is_array($json)?$json:[];
    }
    private static function minute(string $clock): int {
        [$h,$m]=array_map('intval',explode(':',$clock));return $h*60+$m;
    }
    private static function stamp(string $date,int $minutes): int {
        $base=new DateTimeImmutable($date.' 00:00:00',new DateTimeZone('Asia/Tehran'));
        return $base->getTimestamp()+$minutes*60;
    }
    private static function time(string $date): int {return strtotime($date.' 12:00:00 UTC');}
    public static function allowedShiftTraffic(?array $shift,int $at,string $action): bool {
        if(!$shift||!in_array($action,['in','out'],true))return false;
        $cfg=self::config($shift);
        if(!empty($cfg['allow_offday'])||in_array($shift['schedule_kind'],['floating','auto'],true))return true;
        $today=(new DateTimeImmutable('@'.$at))->setTimezone(new DateTimeZone('Asia/Tehran'))->format('Y-m-d');
        $previous=gmdate('Y-m-d',self::time($today)-86400);
        foreach([$today,$previous] as $day){
            $definitions=in_array($shift['schedule_kind'],['advanced','rotation_segments'],true)
                ?self::segments($shift,$day):(self::duty($shift,$day)>0?[['s'=>$shift['start_time'],'e'=>$shift['end_time']]]:[]);
            foreach($definitions as $seg){
                $start=self::minute($seg['s']);$end=self::minute($seg['e']);
                $begin=self::stamp($day,$start);$finish=self::stamp($day,$end<=$start?$end+1440:$end);
                $center=$action==='in'?$begin:$finish;
                if($at>=$center-3600&&$at<=$center+3600)return true;
            }
        }
        return false;
    }
    public static function segments(?array $shift,string $day): array {
        if(!$shift)return [];
        $cfg=self::config($shift);$kind=$shift['schedule_kind'];
        if($kind==='advanced'){
            $weekday=(int)gmdate('w',self::time($day));return $cfg['weekly'][$weekday]??[];
        }
        if($kind==='rotation_segments'){
            $anchor=$cfg['anchor']??null;$cycle=$cfg['cycle']??[];
            if(!$anchor||!$cycle||$day<$anchor)return [];
            $length=array_sum(array_map(fn($phase)=>(int)$phase['days'],$cycle));
            if(!$length)return [];
            $position=(int)floor((self::time($day)-self::time($anchor))/86400)%$length;
            foreach($cycle as $phase){if($position<(int)$phase['days'])return $phase['segments'];$position-=(int)$phase['days'];}
        }
        return [];
    }
    public static function duty(?array $shift,string $day): int {
        if(!$shift)return 0;
        $cfg=self::config($shift);$kind=$shift['schedule_kind'];$base=(int)$shift['duty_minutes'];
        if($kind==='auto')return (int)($cfg['auto_expected_min']??453);
        if(in_array($kind,['advanced','rotation_segments'],true)){
            $total=0;foreach(self::segments($shift,$day) as $seg){$start=self::minute($seg['s']);$end=self::minute($seg['e']);if($end<=$start)$end+=1440;$total+=$end-$start;}
            return $total;
        }
        if($kind==='weekly')return in_array((int)gmdate('w',self::time($day)),$cfg['days']??[],true)?$base:0;
        if($kind==='rotating'){
            $cycle=(int)$cfg['work']+(int)$cfg['rest'];$elapsed=(int)floor((self::time($day)-self::time($cfg['anchor']))/86400);
            $position=(($elapsed%$cycle)+$cycle)%$cycle;return $position<(int)$cfg['work']?$base:0;
        }
        return $base;
    }
    private static function union(array $parts): array {
        usort($parts,fn($a,$b)=>$a[0]<=>$b[0]);$out=[];
        foreach($parts as $p){if($p[1]<=$p[0])continue;$last=count($out)-1;
            if($last>=0&&$p[0]<=$out[$last][1])$out[$last][1]=max($out[$last][1],$p[1]);else $out[]=$p;}
        return $out;
    }
    private static function overlap(array $parts,int $begin,int $end): int {
        $seconds=0;foreach($parts as $p)$seconds+=max(0,min($end,$p[1])-max($begin,$p[0]));
        return (int)floor($seconds/60);
    }
    private static function night(array $parts): int {
        $seconds=0;
        foreach($parts as [$start,$end]){
            $date=(new DateTimeImmutable('@'.$start))->setTimezone(new DateTimeZone('Asia/Tehran'))->modify('-1 day')->format('Y-m-d');
            $last=(new DateTimeImmutable('@'.$end))->setTimezone(new DateTimeZone('Asia/Tehran'))->modify('+1 day')->format('Y-m-d');
            for($i=0;$date<=$last&&$i<45;$i++){
                $a=self::stamp($date,22*60);$b=self::stamp($date,30*60);
                $seconds+=max(0,min($end,$b)-max($start,$a));
                $date=gmdate('Y-m-d',strtotime($date.' 12:00:00 UTC')+86400);
            }
        }
        return (int)floor($seconds/60);
    }
    public static function metrics(?array $shift,string $day,array $raw): array {
        $parts=self::union($raw);$worked=(int)floor(array_sum(array_map(fn($p)=>($p[1]-$p[0])/60,$parts)));
        $night=self::night($parts);
        $result=['worked'=>$worked,'in_shift'=>0,'night'=>$night,'late_in'=>0,'early_out'=>0,'window_extra'=>0];
        if(!$shift)return $result;
        if(in_array($shift['schedule_kind'],['floating','auto'],true)){$result['in_shift']=$worked;return $result;}
        $cfg=self::config($shift);$definition=in_array($shift['schedule_kind'],['advanced','rotation_segments'],true)
            ?self::segments($shift,$day):(self::duty($shift,$day)>0?[['s'=>$shift['start_time'],'e'=>$shift['end_time']]]:[]);
        $periods=[];
        foreach($definition as $seg){$begin=self::minute($seg['s']);$end=self::minute($seg['e']);
            $periods[]=[self::stamp($day,$begin),self::stamp($day,$end<=$begin?$end+1440:$end)];}
        usort($periods,fn($a,$b)=>$a[0]<=>$b[0]);
        if(!$periods)return $result;
        $inside=0;$outside=[];
        foreach($periods as [$begin,$end]){
            $inside+=self::overlap($parts,$begin,$end);
            foreach([[$begin-(int)($cfg['ot_begin']??0)*60,$begin],[$end,$end+(int)($cfg['ot_end']??0)*60]] as [$a,$b])
                foreach($parts as [$p,$q])if(min($q,$b)>max($p,$a))$outside[]=[max($p,$a),min($q,$b)];
        }
        $result['in_shift']=$inside;
        $earliest=$parts[0][0]??null;$latest=$parts[count($parts)-1][1]??null;
        if($earliest!==null)$result['late_in']=max(0,(int)floor(($earliest-$periods[0][0])/60)-(int)($cfg['late_ok']??0));
        if($latest!==null)$result['early_out']=max(0,(int)floor(($periods[count($periods)-1][1]-$latest)/60)-(int)($cfg['early_ok']??0));
        $result['window_extra']=(int)floor(array_sum(array_map(fn($p)=>($p[1]-$p[0])/60,self::union($outside))));
        return $result;
    }
    public static function daily(string $day,array $m,int $duty,int $cap,array $approved,bool $holiday,bool $hasShift): array {
        $friday=gmdate('w',self::time($day))==='5';$worked=(int)$m['worked'];$expected=$friday||$holiday?0:max(0,$duty);
        $leave=0;$unpaid=0;$mission=0;
        foreach($approved as $r){if(in_array($r['type'],['annual_leave','sick_leave'],true))$leave+=(int)$r['minutes'];
            elseif($r['type']==='unpaid_leave')$unpaid+=(int)$r['minutes'];elseif($r['type']==='mission')$mission+=(int)$r['minutes'];}
        $credit=min($expected,$leave+$unpaid+$mission);$inShift=$friday||$holiday?0:(int)$m['in_shift'];
        $shortage=max(0,$expected-min($expected,$inShift)-$credit);$absent=$expected>0&&$worked===0&&$credit===0;
        $extra=max(0,$worked-$expected,(int)$m['window_extra']);
        $ot=$friday||$holiday||!$hasShift||$expected===0?0:min($extra,max(0,$cap));
        $surplus=$friday||$holiday||!$hasShift||$expected===0?0:max(0,$extra-$ot);
        return ['day'=>$day,'worked'=>$worked,'in_shift'=>$inShift,'expected'=>$expected,'leave'=>$leave,'unpaid_leave'=>$unpaid,
            'mission'=>$mission,'shortage'=>$shortage,'absence'=>$absent?$shortage:0,'absence_days'=>$absent?1:0,
            'absence_and_shortage'=>$shortage,'surplus'=>$surplus,'overtime'=>$ot,'night'=>(int)$m['night'],
            'late_in'=>$friday||$holiday||!$hasShift?0:$m['late_in'],'early_out'=>$friday||$holiday||!$hasShift?0:$m['early_out'],
            'friday_work'=>$friday?$worked:0,'holiday_work'=>$holiday&&!$friday?$worked:0,
            'total_overtime'=>$ot+($friday?$worked:0)+($holiday&&!$friday?$worked:0),
            'regular_extra'=>!$friday&&!$holiday?$extra:0];
    }
    public static function totals(array $days): array {
        $keys=['worked','in_shift','expected','leave','unpaid_leave','mission','shortage','absence','absence_days','absence_and_shortage',
            'surplus','overtime','night','late_in','early_out','total_overtime','friday_work','holiday_work','regular_extra','gps_off_minutes','internet_off_minutes'];
        $out=[];foreach($keys as $key)$out[$key]=array_sum(array_map(fn($day)=>(int)($day[$key]??0),$days));return $out;
    }
}
