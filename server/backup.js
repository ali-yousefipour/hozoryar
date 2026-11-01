import { backup } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openDatabase } from './db.js';

const folder=resolve(process.env.BACKUP_DIR||'backups');
mkdirSync(folder,{recursive:true,mode:0o700});
const dest=join(folder,`hozoryar-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
const db=openDatabase();
try{await backup(db,dest);console.log(`Backup completed: ${dest}`)}
finally{db.close()}
