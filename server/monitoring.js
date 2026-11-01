// Explicit device status events are informational evidence, not verified faults
// and not monetary deductions. Missing check-ins or background heartbeats do
// not prove that GPS or the internet was switched off.
export function reportedOfflineMinutes(session,events,now=new Date()){
  const start=Date.parse(session.checked_in_at),end=Math.min(session.checked_out_at?Date.parse(session.checked_out_at):now.getTime(),now.getTime());
  const result={gps_off_minutes:0,internet_off_minutes:0};
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return result;
  const state={gps:null,internet:null};
  for(const event of [...events].sort((a,b)=>a.recorded_at.localeCompare(b.recorded_at))){
    const time=Date.parse(event.recorded_at);
    if(!Number.isFinite(time)||time<start||time>end)continue;
    const [kind,status]=event.kind.split('_');
    if(!(kind in state)||!['on','off'].includes(status))continue;
    if(status==='off'&&state[kind]===null)state[kind]=time;
    if(status==='on'&&state[kind]!==null){result[kind+'_off_minutes']+=Math.floor((time-state[kind])/60000);state[kind]=null;}
  }
  for(const kind of Object.keys(state))if(state[kind]!==null)result[kind+'_off_minutes']+=Math.floor((end-state[kind])/60000);
  return result;
}
