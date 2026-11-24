import React,{useEffect,useRef,useState} from 'react';
import {SafeAreaView,ScrollView,View,Text,TextInput,TouchableOpacity,ActivityIndicator,Alert,StatusBar,StyleSheet,Platform,useColorScheme} from 'react-native';
import {requireOptionalNativeModule} from 'expo';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import {isTracking,startTracking,stopTracking} from './tracking';
import {apiBase} from './api-config.mjs';
import RequestComposer from './RequestComposer';
import {requestTypes} from './request-data.mjs';

const API=String(Constants.expoConfig?.extra?.apiBaseUrl||'').replace(/\/$/,'');
const purple='#6D28D9',ink='#281942',muted='#77698A';
const PENDING_KEY='hozoryar_pending_punch_v1';
async function req(path,token,method='GET',body){
  const endpoint=apiBase(API,__DEV__);
  const res=await fetch(endpoint+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await res.json();if(!res.ok)throw Error(data.error||'خطای ارتباط با سرور');return data;
}
function Button({children,onPress,secondary=false,disabled=false,dark=false}){const styles=appStyles(dark);return <TouchableOpacity accessible accessibilityRole="button" disabled={disabled} style={[styles.button,secondary&&styles.secondary,disabled&&{opacity:.45}]} onPress={onPress}><Text style={[styles.buttonText,secondary&&{color:dark?'#DDD0F5':purple}]}>{children}</Text></TouchableOpacity>}
export default function App(){
  const pendingPunch=useRef(null);
  const systemScheme=useColorScheme();
  const [appearance,setAppearance]=useState('system');
  const dark=appearance==='system'?systemScheme==='dark':appearance==='dark';
  const styles=appStyles(dark);
  async function changeAppearance(value){setAppearance(value);try{await SecureStore.setItemAsync('hozoryar_appearance',value)}catch{Alert.alert('حضوریار','ذخیره ظاهر انجام نشد؛ انتخاب فعلی تا بستن برنامه برقرار است.')}}
  const [token,setToken]=useState(null),[ready,setReady]=useState(false),[company,setCompany]=useState(''),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [me,setMe]=useState(null),[records,setRecords]=useState([]),[requests,setRequests]=useState([]),[busy,setBusy]=useState(false),[tab,setTab]=useState('attendance'),[tracking,setTracking]=useState(false),[hasPending,setHasPending]=useState(false);
  const call=(path,method,body)=>req(path,token,method,body);
  const running=useRef(false);
  const run=async fn=>{if(running.current)return;running.current=true;setBusy(true);try{await fn()}catch(e){Alert.alert('حضوریار',e.message)}finally{running.current=false;setBusy(false)}};
  async function reload(authToken=token){const [m,r,q]=await Promise.all([req('/api/me',authToken),req('/api/attendance',authToken),req('/api/requests?scope=mine',authToken)]);setMe(m.user);setRecords(r.items);setRequests(q.items);setTracking(await isTracking());
    const saved=await SecureStore.getItemAsync(PENDING_KEY);let pending=null;try{pending=JSON.parse(saved||'null')}catch{}
    if(pending?.company_id===m.user.company_id&&pending?.user_id===m.user.id){pendingPunch.current=pending.payload;setHasPending(true)}else{pendingPunch.current=null;setHasPending(false);}}
  useEffect(()=>{(async()=>{try{const savedAppearance=await SecureStore.getItemAsync('hozoryar_appearance');if(['light','dark','system'].includes(savedAppearance))setAppearance(savedAppearance);const saved=await SecureStore.getItemAsync('hozoryar_token');if(saved){setToken(saved);await reload(saved)}}catch{await SecureStore.deleteItemAsync('hozoryar_token');setToken(null)}finally{setReady(true)}})()},[]);
  async function login(){const result=await req('/api/login',null,'POST',{company,username,password});await SecureStore.setItemAsync('hozoryar_token',result.token);setToken(result.token);setPassword('');await reload(result.token);}
  async function logout(){if(hasPending)throw Error('ابتدا تردد در انتظار ارسال را تعیین تکلیف کنید؛ خروج از حساب صف ارسال را پاک نمی‌کند.');try{await call('/api/logout','POST')}finally{pendingPunch.current=null;await stopTracking();await SecureStore.deleteItemAsync('hozoryar_token');setToken(null);setMe(null);setRecords([]);setTracking(false)}}
  async function getPosition(){const result=await Location.requestForegroundPermissionsAsync();if(result.status!=='granted')throw Error('دسترسی موقعیت داده نشده است');const p=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});return {lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}}
  const active=records.find(r=>!r.checked_out_at);
  async function scanWorkplaceWifi(eventId){
    if(Platform.OS!=='android')throw Error('بررسی وای‌فای محل کار در نسخهٔ اندروید در دسترس است');
    const wifi=requireOptionalNativeModule('WorkplaceWifi');
    if(!wifi)throw Error('نسخهٔ اندروید حضوریار با قابلیت بررسی وای‌فای را نصب کنید');
    const permission=await Location.requestForegroundPermissionsAsync();
    if(permission.status!=='granted'||permission.android?.accuracy==='coarse')
      throw Error('برای بررسی وای‌فای، مجوز موقعیت دقیق لازم است');
    try{
      return await wifi.scan(`${me.company_id}:${me.id}:${eventId}:`);
    }catch(error){
      if(error.code==='WIFI_DISABLED')throw Error('وای‌فای گوشی را روشن کنید');
      throw Error('بررسی وای‌فای انجام نشد. وای‌فای و سرویس موقعیت گوشی را بررسی کنید');
    }
  }
  async function punch(){const action=active?'out':'in';
    // Reuse the same id after a timeout: the server can safely replay a committed punch.
    const previous=pendingPunch.current;
    const payload=previous??{action,event_id:`punch_${Date.now()}_${Math.random().toString(36).slice(2,14)}`,...(action==='in'?await getPosition():{})};
    let fingerprints=[];
    if(payload.action==='in'){
      const policy=await call('/api/attendance');
      if(policy.requires_workplace_wifi){
        try{fingerprints=await scanWorkplaceWifi(payload.event_id)}
        catch(error){if(!previous)throw error;}
      }
    }
    if(!previous){
      await SecureStore.setItemAsync(PENDING_KEY,JSON.stringify({company_id:me.company_id,user_id:me.id,payload}));
      pendingPunch.current=payload;
      setHasPending(true);
    }
    await call('/api/attendance','POST',{...payload,...(fingerprints.length?{wifi_fingerprints:fingerprints}:{})});
    const sentAction=pendingPunch.current.action;pendingPunch.current=null;await SecureStore.deleteItemAsync(PENDING_KEY);setHasPending(false);
    if(sentAction==='out'){await stopTracking();setTracking(false)}await reload();Alert.alert('ثبت شد',sentAction==='out'?'خروج شما ثبت شد':'ورود شما ثبت شد')}
  async function discardPending(){Alert.alert('حذف تردد در انتظار','ممکن است درخواست قبلاً به سرور رسیده باشد. ابتدا سوابق را به‌روزرسانی کنید. حذف، تردد ثبت‌شده روی سرور را پاک نمی‌کند.',[
    {text:'انصراف',style:'cancel'},{text:'حذف صف محلی',style:'destructive',onPress:()=>run(async()=>{await SecureStore.deleteItemAsync(PENDING_KEY);pendingPunch.current=null;setHasPending(false);await reload();})}
  ]);}
  async function sendLocation(){await call('/api/location','POST',await getPosition());Alert.alert('حضوریار','موقعیت شما در نقشه زنده ثبت شد')}
  async function toggleTracking(){if(tracking){await stopTracking();setTracking(false)}else{await startTracking();setTracking(true)}}
  if(!ready)return <View style={styles.center}><ActivityIndicator color={purple} size="large"/></View>;
  return <SafeAreaView style={styles.root}><StatusBar barStyle={dark?"light-content":"dark-content"}/><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><View><Text style={styles.title}>حضوریار</Text><Text style={styles.subtitle}>{me?.company_name||'مدیریت هوشمند پرسنل'}</Text></View></View>
    <View accessibilityRole="radiogroup" style={styles.themeChoices}>{[['system','سیستم'],['light','روشن'],['dark','تیره']].map(([value,label])=><TouchableOpacity key={value} accessibilityRole="radio" accessibilityLabel={'ظاهر '+label} accessibilityState={{checked:appearance===value}} style={[styles.themeChoice,appearance===value&&styles.themeSelected]} onPress={()=>changeAppearance(value)}><Text style={styles.item}>{label}</Text></TouchableOpacity>)}</View>
    {!token?<View style={styles.card}><Text style={styles.heading}>ورود به حساب</Text><Text style={styles.label}>شناسه شرکت</Text><TextInput style={styles.input} value={company} onChangeText={setCompany} autoCapitalize="none"/><Text style={styles.label}>نام کاربری</Text><TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none"/><Text style={styles.label}>رمز عبور</Text><TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry/><Button dark={dark} disabled={busy} onPress={()=>run(login)}>ورود</Button></View>:
    <><View style={styles.card}><Text style={styles.greeting}>{me?.name} عزیز، خوش آمدید</Text><Text style={styles.note}>موقعیت فقط با اقدام شما و هنگام حضور فعال به سرور ارسال می‌شود.</Text><View style={styles.tabs}><TouchableOpacity onPress={()=>setTab('attendance')} style={[styles.tab,tab==='attendance'&&styles.tabActive]}><Text style={styles.item}>حضور من</Text></TouchableOpacity><TouchableOpacity onPress={()=>setTab('requests')} style={[styles.tab,tab==='requests'&&styles.tabActive]}><Text style={styles.item}>درخواست‌ها</Text></TouchableOpacity></View></View>
      {tab==='attendance'?<View style={styles.card}><Text style={styles.heading}>{active?'در حال حضور':'حضور فعال ندارید'}</Text>{hasPending&&<View style={styles.pending} accessibilityRole="alert"><Text style={styles.pendingText}>تردد قبلی در انتظار تأیید سرور است. با اتصال اینترنت، «تلاش مجدد» را بزنید؛ همان شناسه برای جلوگیری از ثبت تکراری ارسال می‌شود. زمان ثبت، زمان دریافت سرور خواهد بود.</Text><Button dark={dark} secondary disabled={busy} onPress={discardPending}>لغو صف پس از بررسی سوابق</Button></View>}<Button dark={dark} disabled={busy} onPress={()=>run(punch)}>{hasPending?'تلاش مجدد برای ثبت تردد قبلی':active?'ثبت خروج':'ثبت ورود با GPS'}</Button>{active&&<Button dark={dark} secondary disabled={busy} onPress={()=>run(sendLocation)}>ارسال موقعیت فعلی</Button>}{active&&<Button dark={dark} secondary disabled={busy} onPress={()=>run(toggleTracking)}>{tracking?'توقف پایش پس‌زمینه':'فعال‌کردن اختیاری پایش پس‌زمینه'}</Button>}<Text style={styles.note}>پایش پس‌زمینه فقط با اجازه شما فعال می‌شود و اعلان دائمی اندروید دارد. زمان‌بندی ارسال در همه گوشی‌ها تضمین‌شده نیست.</Text><Text style={styles.heading}>سوابق اخیر</Text>{records.slice(0,15).map(r=><View key={r.id} style={styles.row}><Text style={styles.item}>{new Date(r.checked_in_at).toLocaleString('fa-IR')}</Text><Text style={styles.note}>{r.checked_out_at?'خروج: '+new Date(r.checked_out_at).toLocaleString('fa-IR'):'حاضر'}</Text></View>)}</View>:
      <View style={styles.card}><RequestComposer dark={dark} call={call} run={run} busy={busy} onSubmitted={async()=>{await reload();Alert.alert("حضوریار","درخواست برای بررسی مدیر ثبت شد.")}}/><Text style={styles.heading}>درخواست‌های من</Text>{requests.map(r=><View key={r.id} style={styles.row}><Text style={styles.item}>{requestTypes[r.type]||r.type} · {r.work_date}</Text><Text style={styles.note}>{r.minutes} دقیقه · {r.status==='approved'?'تأیید':r.status==='rejected'?'رد':'در انتظار'}</Text></View>)}{requests.length===0&&<Text style={styles.note}>درخواستی ثبت نشده است.</Text>}</View>}
      <Button dark={dark} secondary disabled={busy} onPress={()=>run(()=>reload())}>به‌روزرسانی</Button><Button dark={dark} secondary disabled={busy} onPress={()=>run(logout)}>خروج از حساب</Button></>}
  </ScrollView></SafeAreaView>;
}
function appStyles(dark){const ink=dark?'#F2EDF8':'#281942',muted=dark?'#BEB4CC':'#62556E',purple=dark?'#C4B5FD':'#6D28D9';return StyleSheet.create({root:{flex:1,backgroundColor:dark?'#14121B':'#F5F3FF'},content:{padding:20,paddingBottom:50,gap:16},center:{flex:1,alignItems:'center',justifyContent:'center'},header:{flexDirection:'row-reverse',alignItems:'center',gap:14,marginVertical:14},logo:{width:80,height:80,borderRadius:18},title:{fontSize:29,fontWeight:'900',color:purple,textAlign:'right'},subtitle:{color:muted,textAlign:'right'},card:{backgroundColor:dark?'#211B2D':'white',padding:20,borderRadius:20,gap:14,borderWidth:1,borderColor:dark?'#4A405A':'#E8DFFF'},heading:{fontWeight:'800',fontSize:20,color:ink,textAlign:'right'},greeting:{fontSize:17,fontWeight:'700',color:ink,textAlign:'right'},label:{textAlign:'right',color:ink},input:{borderWidth:1,borderColor:dark?'#70617F':'#B9AEC9',borderRadius:12,padding:12,textAlign:'right',minHeight:48,color:ink},button:{backgroundColor:'#6D28D9',minHeight:50,borderRadius:12,alignItems:'center',justifyContent:'center',paddingHorizontal:16},secondary:{backgroundColor:dark?'#352747':'#EFE7FF',borderWidth:1,borderColor:dark?'#66517E':'#DBC7FF'},buttonText:{color:'white',fontSize:15,fontWeight:'800'},tabs:{flexDirection:'row-reverse',gap:10},tab:{flex:1,padding:14,borderRadius:12,backgroundColor:dark?'#352747':'#F1EDFA',alignItems:'center'},tabActive:{backgroundColor:dark?'#57416F':'#DCCBFF'},themeChoices:{flexDirection:'row-reverse',gap:8},themeChoice:{padding:12,minHeight:48,borderRadius:8,borderWidth:1,borderColor:dark?'#66517E':'#DBC7FF'},themeSelected:{backgroundColor:dark?'#57416F':'#DCCBFF'},row:{borderBottomWidth:1,borderColor:dark?'#4A405A':'#EEE8F5',paddingBottom:10,gap:5},item:{textAlign:'right',fontWeight:'700',color:ink},note:{textAlign:'right',color:muted,lineHeight:22},pending:{backgroundColor:'#FFF7E6',padding:12,borderRadius:12,borderWidth:1,borderColor:'#E3BB72',gap:10},pendingText:{textAlign:'right',lineHeight:24,color:'#643A08'}});}
