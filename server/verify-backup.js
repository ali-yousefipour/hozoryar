import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { statSync } from 'node:fs';

const supplied=process.argv[2];
if(!supplied||!supplied.endsWith('.sqlite')){
  console.error('Usage: npm run verify-backup -- /absolute/path/to/backup.sqlite');
  process.exitCode=1;
}else{
  const path=resolve(supplied);
  try{
    if(!statSync(path).isFile())throw Error('مسیر فایل نیست');
    const db=new DatabaseSync(path,{readOnly:true});
    try{
      const integrity=db.prepare('PRAGMA integrity_check').all();
      const fk=db.prepare('PRAGMA foreign_key_check').all();
      if(integrity.length!==1||integrity[0].integrity_check!=='ok'||fk.length)throw Error('سلامت پایگاه داده تأیید نشد');
      const count=db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name IN ('companies','users','attendance')").get().n;
      if(count!==3)throw Error('جداول اصلی حضوریار وجود ندارند');
      console.log(`Backup verified: ${path}`);
    }finally{db.close();}
  }catch(e){console.error('Backup verification failed:',e.message);process.exitCode=1;}
}
