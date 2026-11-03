import { requireValue } from './errors.js';

export function createBudgets({config,now,get,run,transaction}) {
  function reserveInside({kind,user,phone='',travel='',network='',fingerprint='',requestId}) {
    const budget=config[kind],current=now(),date=new Date(current),day=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()),month=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
    run("UPDATE reservations SET status='failed' WHERE kind='ai' AND status='pending' AND created<=?",current-180000);
    const prior=get('SELECT * FROM reservations WHERE id=?',requestId);
    if(prior){requireValue(prior.user_id===user && prior.kind===kind && prior.travel===travel && prior.phone===phone && prior.fingerprint===fingerprint,409,'request_conflict');return {...prior,reused:true};}
    requireValue(budget && budget.cost>0,503,'service_disabled');
    const sum=get('SELECT count(*) AS calls,coalesce(sum(cost),0) AS cost FROM reservations WHERE kind=? AND created>=?',kind,month);
    const daily=get('SELECT count(*) AS calls,coalesce(sum(cost),0) AS cost FROM reservations WHERE kind=? AND created>=?',kind,day);
    requireValue(sum.calls<budget.monthlyCalls && sum.cost+budget.cost<=budget.monthlyCost && daily.calls<budget.dailyCalls && daily.cost+budget.cost<=budget.dailyCost,429,'usage_limit');
    if(kind==='ai') {
      run("UPDATE reservations SET status='failed' WHERE kind='ai' AND status='pending' AND created<=?",current-180000);
      for(const [field,value] of [['user_id',user],['phone',phone],['travel',travel]])requireValue(get(`SELECT count(*) AS n FROM reservations WHERE kind='ai' AND ${field}=? AND created>=?`,value,day).n<1,429,'daily_ai_limit');
      requireValue(get("SELECT count(*) AS n FROM reservations WHERE kind='ai' AND status='pending'").n<3,429,'ai_busy');
      requireValue(get("SELECT count(*) AS n FROM reservations WHERE kind='ai' AND status='pending' AND user_id=?",user).n<1,429,'ai_busy');
    } else {
      for(const [field,value,limit] of [['user_id',user,3],['phone',phone,3],['network',network,20]])requireValue(get(`SELECT count(*) AS n FROM reservations WHERE kind='sms' AND ${field}=? AND created>=?`,value,day).n<limit,429,'sms_limit');
      requireValue(!get("SELECT id FROM reservations WHERE kind='sms' AND (user_id=? OR phone=?) AND created>?",user,phone,current-60000),429,'sms_cooldown');
    }
    run('INSERT INTO reservations(id,kind,user_id,phone,travel,network,fingerprint,cost,created,status) VALUES(?,?,?,?,?,?,?,?,?,?)',requestId,kind,user,phone,travel,network,fingerprint,budget.cost,current,'pending');
    return {id:requestId,status:'pending',reused:false};
  }
  return {
    reserveInside,
    reserve(args){return transaction(()=>reserveInside(args));},
    finishReservation(id,status,result=null){run("UPDATE reservations SET status=?,result=? WHERE id=? AND status='pending'",status,result,id);},
    reservation(user,id){const row=get('SELECT id AS requestId,status,result FROM reservations WHERE user_id=? AND id=?',user,id);return row?{requestId:row.requestId,status:row.status,...(row.result?{text:row.result}:{})}:null;},
  };
}
