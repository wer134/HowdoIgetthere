import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { schema } from './schema.js';
import { cleanSnapshot, cleanPlace } from './snapshot.js';
import { requireValue } from './errors.js';
import { createBudgets } from './usage.js';

const DAY = 86400000;
export function createAccountStore(config) {
  if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), {recursive:true, mode:0o700});
  const db = new DatabaseSync(config.dbPath); db.exec(schema);
  if (config.dbPath !== ':memory:') fs.chmodSync(config.dbPath,0o600);
  const now = config.now || Date.now;
  const hash = value => createHmac('sha256', config.secret).update(value).digest('hex');
  const key = createHash('sha256').update(config.secret).digest();
  const get = (sql,...args) => db.prepare(sql).get(...args);
  const all = (sql,...args) => db.prepare(sql).all(...args);
  const run = (sql,...args) => db.prepare(sql).run(...args);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value=fn(); db.exec('COMMIT'); return value; } catch(error) { db.exec('ROLLBACK'); throw error; }
  }
  const token = () => randomBytes(32).toString('base64url');
  function encrypt(value) {
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
    const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');
  }
  function decrypt(value) {
    const data=Buffer.from(value,'base64'), cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
    cipher.setAuthTag(data.subarray(12,28)); return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8');
  }
  function userView(row) {
    return row ? {id:row.id,name:row.name,email:row.email,phoneVerified:Boolean(row.phone_verified && row.phone_verified > now()-180*DAY)} : null;
  }
  function owned(user,id) {
    const row=get('SELECT * FROM travels WHERE id=? AND owner=?',id,user); requireValue(row,404,'not_found'); return row;
  }
  const travelView = row => ({id:row.id, version:row.version, snapshot:JSON.parse(row.data)});
  function serialized(snapshot,id) {
    const clean=cleanSnapshot(snapshot,id); clean.updated=now(); const data=JSON.stringify(clean), bytes=Buffer.byteLength(data);
    requireValue(bytes<=config.maxTravelBytes,413,'travel_too_large'); return {clean,data,bytes};
  }
  function quota(user,bytes,oldBytes=0,creating=false) {
    const totals=get('SELECT count(*) AS count,coalesce(sum(bytes),0) AS bytes FROM travels WHERE owner=?',user);
    requireValue(!creating || totals.count<config.maxTravels,409,'travel_limit');
    requireValue(totals.bytes-oldBytes+bytes<=config.maxUserBytes,413,'storage_limit');
    requireValue(get('SELECT coalesce(sum(bytes),0) AS bytes FROM travels').bytes-oldBytes+bytes<=config.maxTotalBytes,503,'service_storage_limit');
  }
  function update(user,id,snapshot,version) {
    const old=owned(user,id); requireValue(Number.isSafeInteger(version) && old.version===version,409,'conflict');
    const {clean,data,bytes}=serialized(snapshot,id); quota(user,bytes,old.bytes);
    run('UPDATE travels SET version=version+1,data=?,bytes=?,name=?,updated=? WHERE id=?',data,bytes,clean.name,clean.updated,id);
    return {id,version:version+1,snapshot:clean};
  }
  function shared(raw) {
    requireValue(typeof raw==='string' && raw.length===43,404,'not_found');
    const row=get('SELECT t.*,s.expires FROM shares s JOIN travels t ON t.id=s.travel_id WHERE s.hash=? AND s.expires>?',hash(raw),now());
    requireValue(row,404,'not_found'); return row;
  }
  const usage=createBudgets({config,now,get,all,run,transaction});
  return {
    ...usage, hash, encrypt, decrypt, now,
    close(){db.close();},
    upsertUser(identity) {
      requireValue(identity && typeof identity.sub==='string' && identity.sub.length>0 && identity.sub.length<=255,400,'invalid_identity');
      return transaction(()=>{
        let row=get('SELECT * FROM users WHERE sub=?',identity.sub);
        const name=String(identity.name || '여행자').slice(0,200),email=String(identity.email || '').slice(0,320);
        if(!row) {
          requireValue(get('SELECT count(*) AS n FROM users').n<config.maxAccounts,503,'account_limit');
          const id=randomUUID(); run('INSERT INTO users(id,sub,name,email) VALUES(?,?,?,?)',id,identity.sub,name,email); row=get('SELECT * FROM users WHERE id=?',id);
        } else {run('UPDATE users SET name=?,email=? WHERE id=?',name,email,row.id);row={...row,name,email};}
        return userView(row);
      });
    },
    user(id){return userView(get('SELECT * FROM users WHERE id=?',id));},
    createSession(user) {
      return transaction(()=>{
        run('DELETE FROM sessions WHERE expires<=?',now());
        const raw=token();run('INSERT INTO sessions VALUES(?,?,?,?)',hash(raw),user,now(),now()+7*DAY);
        run('DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE user_id=? ORDER BY created DESC,rowid DESC LIMIT -1 OFFSET 10)',user);return raw;
      });
    },
    session(raw){return typeof raw==='string' ? userView(get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?',hash(raw),now())) : null;},
    logout(raw){if(raw)run('DELETE FROM sessions WHERE hash=?',hash(raw));},
    putFlow(data,network='internal') {
      return transaction(()=>{
        run('DELETE FROM flows WHERE expires<=?',now());run('DELETE FROM login_attempts WHERE created<=?',now()-10*60000);
        requireValue(get('SELECT count(*) AS n FROM login_attempts WHERE network=?',network).n<10,429,'login_rate_limit');
        requireValue(get('SELECT count(*) AS n FROM flows').n<1000,429,'login_busy');
        const raw=token();run('INSERT INTO flows VALUES(?,?,?)',hash(raw),JSON.stringify(data),now()+10*60000);run('INSERT INTO login_attempts VALUES(?,?)',network,now());return raw;
      });
    },
    takeFlow(raw) {return transaction(()=>{if(!raw)return null;const row=get('SELECT * FROM flows WHERE hash=? AND expires>?',hash(raw),now());run('DELETE FROM flows WHERE hash=?',hash(raw));return row?JSON.parse(row.data):null;});},
    listTravels(user){return all('SELECT id,name,updated,version FROM travels WHERE owner=? ORDER BY updated DESC',user);},
    getTravel(user,id){return travelView(owned(user,id));},
    createTravel(user,snapshot){return transaction(()=>{const id=randomUUID(),{clean,data,bytes}=serialized(snapshot,id);quota(user,bytes,0,true);run('INSERT INTO travels VALUES(?,?,1,?,?,?,?)',id,user,data,bytes,clean.name,clean.updated);return {id,version:1,snapshot:clean};});},
    saveTravel(user,id,snapshot,version){return transaction(()=>update(user,id,snapshot,version));},
    deleteTravel(user,id,version){return transaction(()=>{requireValue(owned(user,id).version===version,409,'conflict');run('DELETE FROM travels WHERE id=?',id);return {ok:true};});},
    createShare(user,id,version){return transaction(()=>{requireValue(owned(user,id).version===version,409,'conflict');const raw=token(),expiresAt=now()+30*DAY;run('DELETE FROM shares WHERE travel_id=?',id);run('INSERT INTO shares VALUES(?,?,?)',hash(raw),id,expiresAt);return {token:raw,expiresAt};});},
    revokeShare(user,id){owned(user,id);run('DELETE FROM shares WHERE travel_id=?',id);return {ok:true};},
    readShare(raw){const row=shared(raw);return {snapshot:JSON.parse(row.data),expiresAt:row.expires};},
    suggest(user,raw,place){return transaction(()=>{
      const row=shared(raw),clean=cleanPlace(place);
      requireValue(get('SELECT count(*) AS n FROM suggestions').n<config.maxSuggestions,503,'suggestion_limit');
      requireValue(get('SELECT count(*) AS n FROM suggestions WHERE author=? AND created>?',user,now()-DAY).n<20,429,'suggestion_limit');
      const id=randomUUID();run('INSERT INTO suggestions(id,travel_id,author,place,created) VALUES(?,?,?,?,?)',id,row.id,user,JSON.stringify(clean),now());return {id};
    });},
    listSuggestions(user,id){owned(user,id);return all('SELECT s.id,s.place,s.status,s.created AS createdAt,u.name AS authorName FROM suggestions s JOIN users u ON u.id=s.author WHERE s.travel_id=? ORDER BY s.created DESC LIMIT 200',id).map(row=>({...row,place:JSON.parse(row.place)}));},
    acceptSuggestion(user,id,suggestion,version){return transaction(()=>{
      const travel=owned(user,id),row=get('SELECT * FROM suggestions WHERE id=? AND travel_id=?',suggestion,id);requireValue(row,404,'not_found');requireValue(row.status==='pending',409,'already_reviewed');
      const snapshot=JSON.parse(travel.data);snapshot.library.push(JSON.parse(row.place));const result=update(user,id,snapshot,version);run("UPDATE suggestions SET status='accepted' WHERE id=?",suggestion);return result;
    });},
    startPhone(user,phone,network) {
      return transaction(()=>{
        const row=get('SELECT * FROM users WHERE id=?',user),phoneHash=hash(phone);
        requireValue(!row.phone_hash || row.phone_hash===phoneHash || row.phone_changed<=now()-30*DAY,429,'phone_change_wait');
        usage.reserveInside({kind:'sms',user,phone:phoneHash,travel:'',network,requestId:randomUUID()});
        run('INSERT INTO phone_pending(user_id,phone_hash,cipher,created,attempts) VALUES(?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET phone_hash=excluded.phone_hash,cipher=excluded.cipher,created=excluded.created,attempts=0',user,phoneHash,encrypt(phone),now());
        return {phone};
      });
    },
    checkPhone(user) {
      return transaction(()=>{
        run('DELETE FROM check_attempts WHERE created<?',now()-10*60000);
        requireValue(get('SELECT count(*) AS n FROM check_attempts WHERE user_id=?',user).n<10,429,'verification_limit');
        const pending=get('SELECT * FROM phone_pending WHERE user_id=?',user);
        requireValue(pending && pending.created>now()-10*60000 && pending.attempts<5,429,'verification_expired');
        run('INSERT INTO check_attempts VALUES(?,?)',user,now());run('UPDATE phone_pending SET attempts=attempts+1 WHERE user_id=?',user);
        return {phone:decrypt(pending.cipher),hash:pending.phone_hash,created:pending.created};
      });
    },
    verifyPhone(user,expected) {
      return transaction(()=>{
        const pending=get('SELECT * FROM phone_pending WHERE user_id=?',user);requireValue(pending && pending.created>now()-10*60000 && pending.phone_hash===expected.hash && pending.created===expected.created,409,'verification_changed');
        run('UPDATE users SET phone_changed=CASE WHEN phone_hash IS NULL OR phone_hash<>? THEN ? ELSE phone_changed END,phone_hash=?,phone_cipher=?,phone_verified=? WHERE id=?',pending.phone_hash,now(),pending.phone_hash,pending.cipher,now(),user);
        run('DELETE FROM phone_pending WHERE user_id=?',user);return {ok:true};
      });
    },
    aiIdentity(user,id){owned(user,id);const row=get('SELECT * FROM users WHERE id=?',user);requireValue(row.phone_hash && row.phone_verified>now()-180*DAY,403,'phone_required');return row.phone_hash;},
  };
}
