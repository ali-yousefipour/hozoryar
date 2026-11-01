<?php
declare(strict_types=1);

// Lightweight OOXML writer, following the same ZIP/RTL/duration format as the
// existing Hozoryar exporter and Khatyar's PHP XlsxWriter pattern.
final class XlsxExport {
    private const FIELDS=[
        ['worked','حضور کل'],['in_shift','حضور در شیفت'],['expected','موظفی'],['late_in','تأخیر ورود'],
        ['early_out','تعجیل خروج'],['shortage','کسری کار'],['absence','غیبت'],['night','شب‌کاری'],
        ['overtime','اضافه‌کاری'],['mission','مأموریت'],['leave','مرخصی با حقوق'],
        ['unpaid_leave','مرخصی بدون حقوق'],['surplus','مازاد حضور'],['holiday_work','تعطیل‌کاری'],
        ['friday_work','جمعه‌کاری'],['gps_off_minutes','GPS خاموش (نظارتی)'],
        ['internet_off_minutes','اینترنت خاموش (نظارتی)']
    ];
    private static function xml($s): string {
        return htmlspecialchars((string)$s,ENT_QUOTES|ENT_XML1,'UTF-8');
    }
    private static function column(int $index): string {
        $s='';$index++;
        while($index>0){$index--; $s=chr(65+$index%26).$s;$index=intdiv($index,26);}
        return $s;
    }
    private static function cell($value,int $column,int $row,int $style=0): string {
        $reference=self::column($column).$row;
        if(is_numeric($value)&&!is_string($value))return '<c r="'.$reference.'" s="'.$style.'"><v>'.(string)$value.'</v></c>';
        return '<c r="'.$reference.'" t="inlineStr" s="'.$style.'"><is><t>'.self::xml($value).'</t></is></c>';
    }
    public static function bytes(array $snapshot): string {
        if(!class_exists('ZipArchive'))throw new RuntimeException('PHP zip extension is required');
        $rows=[['گزارش بایگانی کارکرد '.$snapshot['month'].' — غیرقطعی و غیرمالی'],
            array_merge(['نام کارمند','سمت'],array_column(self::FIELDS,1))];
        foreach($snapshot['reports'] as $person){$totals=$person['report']['totals'];$values=[$person['name'],$person['role']];
            foreach(self::FIELDS as [$key])$values[]=((int)($totals[$key]??0))/1440;
            $rows[]=$values;
        }
        $sheetRows='';
        foreach($rows as $i=>$cells){$index=$i+1;$xml='';
            foreach($cells as $j=>$value)$xml.=self::cell($value,$j,$index,$i===1?1:($i>1&&$j>=2?2:0));
            $sheetRows.='<row r="'.$index.'"'.($i===0?' ht="34" customHeight="1"':'').'>'.$xml.'</row>';
        }
        $sheet='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'.
          '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews>'.
          '<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/>'.
          '<col min="3" max="19" width="18" customWidth="1"/></cols><sheetData>'.$sheetRows.'</sheetData></worksheet>';
        $styles='<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'.
          '<numFmts count="1"><numFmt numFmtId="164" formatCode="[h]:mm"/></numFmts>'.
          '<fonts count="2"><font><sz val="11"/><name val="Vazirmatn"/></font>'.
          '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Vazirmatn"/></font></fonts>'.
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6D28D9"/><bgColor indexed="64"/></patternFill></fill></fills>'.
          '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'.
          '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'.
          '<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFill="1" applyFont="1"/>'.
          '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';
        $files=[
          '[Content_Types].xml'=>'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
          '_rels/.rels'=>'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
          'xl/workbook.xml'=>'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="کارکرد" sheetId="1" r:id="rId1"/></sheets></workbook>',
          'xl/_rels/workbook.xml.rels'=>'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
          'xl/styles.xml'=>$styles,'xl/worksheets/sheet1.xml'=>$sheet
        ];
        $file=tempnam(sys_get_temp_dir(),'hz_xlsx_');
        if($file===false)throw new RuntimeException('Could not create XLSX temp file');
        try{
            $zip=new ZipArchive();if($zip->open($file,ZipArchive::OVERWRITE)!==true)throw new RuntimeException('Could not create XLSX archive');
            foreach($files as $name=>$content)$zip->addFromString($name,$content);
            if(!$zip->close())throw new RuntimeException('Could not finalize XLSX archive');
            $data=file_get_contents($file);if($data===false)throw new RuntimeException('Could not read XLSX archive');
            return $data;
        }finally{if(is_file($file))unlink($file);}
    }
}
