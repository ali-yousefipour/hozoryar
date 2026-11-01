import { deflateRawSync } from 'node:zlib';

const enc=new TextEncoder();
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function crc32(buf){let crc=0xffffffff;for(const b of buf){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function zip(files){const local=[],central=[];let offset=0;
  for(const [name,content] of files){const data=Buffer.from(enc.encode(content)),packed=deflateRawSync(data),filename=Buffer.from(name),crc=crc32(data);
    const l=Buffer.alloc(30);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(8,8);l.writeUInt32LE(crc,14);l.writeUInt32LE(packed.length,18);l.writeUInt32LE(data.length,22);l.writeUInt16LE(filename.length,26);
    local.push(l,filename,packed);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
    central.push(c,filename);offset+=l.length+filename.length+packed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
const col=n=>{let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;};
const cell=(value,index,row,style)=>{
  const ref=`${col(index+1)}${row}`,attr=style?` s="${style}"`:'';
  if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}"${attr}><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${attr}><is><t>${xml(value)}</t></is></c>`;
};
export function archivedWorkXlsx(snapshot){
  const fields=[['worked','حضور کل'],['in_shift','حضور در شیفت'],['expected','موظفی'],['late_in','تأخیر ورود'],['early_out','تعجیل خروج'],['shortage','کسری کار'],['absence','غیبت'],['night','شب‌کاری'],['overtime','اضافه‌کاری'],['mission','مأموریت'],['leave','مرخصی'],['surplus','مازاد حضور'],['holiday_work','تعطیل‌کاری'],['friday_work','جمعه‌کاری']];
  const rows=[[`گزارش بایگانی کارکرد ${snapshot.month} — غیرقطعی و غیرمالی`],['نام کارمند','سمت',...fields.map(x=>x[1])]];
  for(const person of snapshot.reports){const totals=person.report.totals;rows.push([person.name,person.role,...fields.map(([key])=>(totals[key]||0)/1440)]);}
  const sheetRows=rows.map((values,i)=>`<row r="${i+1}"${i===0?' ht="34" customHeight="1"':''}>${values.map((v,j)=>cell(v,j,i+1,i===1?1:i>1&&j>=2?2:0)).join('')}</row>`).join('');
  const widths=`<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/><col min="3" max="16" width="18" customWidth="1"/></cols>`;
  const sheet=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews>${widths}<sheetData>${sheetRows}</sheetData></worksheet>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="[h]:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Vazirmatn"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Vazirmatn"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF6D28D9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  return zip([
    ['[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="کارکرد" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml',styles],['xl/worksheets/sheet1.xml',sheet]
  ]);
}
