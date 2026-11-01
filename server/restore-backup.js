import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, renameSync, statSync, constants } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const [backupFile,confirm]=process.argv.slice(2);
const target=process.env.DB_PATH?resolve(process.env.DB_PATH):null;
const source=backupFile?resolve(backupFile):null;
if(!source||!target||confirm!=='--offline-confirm'||source===target||!source.endsWith('.sqlite')||!target.endsWith('.sqlite')){
  console.error('Requires DB_PATH and: npm run restore-backup -- /absolute/path/backup.sqlite --offline-confirm (server MUST be stopped)');
  process.exitCode=1;
}else{
  let staged=null,moved=null;
  try{
    if(!statSync(source).isFile()||statSync(source).size<4096)throw Error('فایل پشتیبان معتبر نیست');
    if(existsSync(target+'-wal')||existsSync(target+'-shm'))throw Error('فایل‌های WAL/SHM موجودند؛ سرویس را کامل متوقف و وضعیت SQLite را بررسی کنید');
    const src=new DatabaseSync(source,{readOnly:true});
    try{
      if(src.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||src.prepare('PRAGMA foreign_key_check').all().length)
        throw Error('اعتبارسنجی پایگاه داده ناموفق است');
      if(src.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('companies','users','attendance')").get().n!==3)
        throw Error('جداول پایه حضوریار یافت نشد');
    }finally{src.close();}
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    staged=join(dirname(target),`.hozoryar-restore-${process.pid}-${stamp}.sqlite`);
    copyFileSync(source,staged,constants.COPYFILE_EXCL);
    if(existsSync(target)){
      moved=target+'.pre-restore-'+stamp;
      renameSync(target,moved);
    }
    try{renameSync(staged,target);staged=null;}
    catch(e){if(moved)renameSync(moved,target);moved=null;throw e;}
    console.log('Restore completed offline:',target);
    if(moved)console.log('Original database preserved:',moved);
  }catch(e){console.error('Restore failed:',e.message);process.exitCode=1;
    if(staged)console.error('Staged file for manual inspection:',staged);
  }
}
