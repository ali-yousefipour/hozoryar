import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const TASK='hozoryar-opt-in-background-location';
const base=String(Constants.expoConfig?.extra?.apiBaseUrl||'').replace(/\/$/,'');
TaskManager.defineTask(TASK,async({data,error})=>{
  if(error||!data?.locations?.length||!base.startsWith('https://')||base.includes('example'))return;
  const token=await SecureStore.getItemAsync('hozoryar_token');if(!token)return;
  const p=data.locations[data.locations.length-1];
  try {
    const res=await fetch(base+'/api/location',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy})});
    // After checkout or expired session, background updates no longer have authority to send.
    if([401,403].includes(res.status))await stopTracking();
  } catch { /* transient network failure: never pretend location was delivered */ }
});

export async function isTracking(){return Location.hasStartedLocationUpdatesAsync(TASK);}
export async function stopTracking(){if(await isTracking())await Location.stopLocationUpdatesAsync(TASK);}
export async function startTracking(){
  const foreground=await Location.requestForegroundPermissionsAsync();if(foreground.status!=='granted')throw Error('مجوز موقعیت در زمان استفاده داده نشده است');
  const background=await Location.requestBackgroundPermissionsAsync();if(background.status!=='granted')throw Error('مجوز موقعیت پس‌زمینه داده نشده است');
  if(await isTracking())return;
  await Location.startLocationUpdatesAsync(TASK,{
    accuracy:Location.Accuracy.Balanced,distanceInterval:100,timeInterval:300000,
    foregroundService:{notificationTitle:'حضوریار · نظارت فعال',notificationBody:'اشتراک موقعیت در شیفت فعال است؛ از داخل برنامه می‌توانید آن را متوقف کنید.',notificationColor:'#6D28D9'}
  });
}
