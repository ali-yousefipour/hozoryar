import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, encoded) {
  if (typeof encoded !== 'string' || !/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(encoded)) return false;
  const [salt, value] = encoded.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(value, 'hex'));
}
export function issueSession(db, user) {
  const token = randomBytes(32).toString('hex');
  const expires = Date.now() + 12 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions(token_hash,company_id,user_id,expires_at) VALUES(?,?,?,?)')
    .run(hash(token),user.company_id,user.id,expires);
  return {token,expires};
}
export function resolveSession(db, authorization) {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization || '');
  if (!match) return null;
  return db.prepare(`SELECT u.id, u.name, u.role, u.company_id, c.name company_name
    FROM sessions s JOIN users u ON u.id=s.user_id AND u.company_id=s.company_id
    JOIN companies c ON c.id=u.company_id
    WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 AND c.active=1`)
    .get(hash(match[1]),Date.now()) || null;
}
export function revokeSession(db, token) {
  if (/^[0-9a-f]{64}$/.test(token || '')) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
}
export function issuePlatformSession(db,admin){
  const token=randomBytes(32).toString('hex'),expires=Date.now()+8*60*60*1000;
  db.prepare('INSERT INTO platform_sessions(token_hash,admin_id,expires_at) VALUES(?,?,?)').run(hash(token),admin.id,expires);
  return {token,expires};
}
export function resolvePlatformSession(db,authorization){
  const match=/^Bearer ([0-9a-f]{64})$/.exec(authorization||'');
  if(!match)return null;
  return db.prepare(`SELECT a.id,a.name,a.username FROM platform_sessions s
    JOIN platform_admins a ON a.id=s.admin_id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`)
    .get(hash(match[1]),Date.now())||null;
}
export function revokePlatformSession(db,token){
  if(/^[0-9a-f]{64}$/.test(token||''))db.prepare('DELETE FROM platform_sessions WHERE token_hash=?').run(hash(token));
}
