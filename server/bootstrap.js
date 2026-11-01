import { openDatabase } from './db.js';
import { passwordHash } from './auth.js';

const [slug,company,username,password,person] = process.argv.slice(2);
if (!slug || !company || !username || !password || !person || password.length < 12 || !/^[a-z0-9-]{3,40}$/.test(slug)) {
  console.error('Usage: npm run bootstrap -- <company-slug> <company-name> <admin-username> <password-min-12> <admin-display-name>');
  process.exit(1);
}
const db = openDatabase();
try {
  db.exec('BEGIN IMMEDIATE');
  const companyId = Number(db.prepare('INSERT INTO companies(name,slug) VALUES(?,?)').run(company,slug).lastInsertRowid);
  db.prepare('INSERT INTO users(company_id,name,username,password_hash,role) VALUES(?,?,?,?,?)')
    .run(companyId,person,username,passwordHash(password),'owner');
  db.prepare('INSERT INTO company_settings(company_id) VALUES(?)').run(companyId);
  db.exec('COMMIT');
  console.log(`Company created: ${slug} (#${companyId})`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Company not created:', err.message);
  process.exitCode = 1;
} finally { db.close(); }
