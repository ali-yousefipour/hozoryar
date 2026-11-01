import { openDatabase } from './db.js';
import { passwordHash } from './auth.js';

const [username,name]=process.argv.slice(2);
const password=process.env.HOZORYAR_PLATFORM_PASSWORD;
if(!/^[a-z0-9_.-]{3,60}$/i.test(username||'')||!password||password.length<12||!name?.trim()){
  console.error('Set HOZORYAR_PLATFORM_PASSWORD (min 12 chars), then: npm run platform-admin -- <username> <display-name>');
  process.exitCode=1;
}else{
  const db=openDatabase();
  try{
    db.prepare(`INSERT INTO platform_admins(username,name,password_hash) VALUES(?,?,?)
      ON CONFLICT(username) DO UPDATE SET name=excluded.name,password_hash=excluded.password_hash,active=1`)
      .run(username,name,passwordHash(password));
    console.log('Platform administrator created/updated:',username);
  }finally{db.close();}
}
