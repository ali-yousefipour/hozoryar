import React,{useEffect,useRef,useState} from 'react';
import {SafeAreaView,ScrollView,View,Text,TextInput,TouchableOpacity,Image,ActivityIndicator,Alert,StatusBar,StyleSheet} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import {isTracking,startTracking,stopTracking} from './tracking';

const API=String(Constants.expoConfig?.extra?.apiBaseUrl||'').replace(/\/$/,'');
const purple='#6D28D9',ink='#281942',muted='#77698A';
const PENDING_KEY='hozoryar_pending_punch_v1';
async function req(path,token,method='GET',body){
  if(!API.startsWith('https://')||API.includes('example'))throw Error('آدرس HTTPS سرور حضوریار در app.json تنظیم نشده است');
  const res=await fetch(API+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await res.json();if(!res.ok)throw Error(data.error||'خطای ارتباط با سرور');return data;
}
function Button({children,onPress,secondary=false,disabled=false}){return <TouchableOpacity accessible accessibilityRole="button" disabled={disabled} style={[styles.button,secondary&&styles.secondary,disabled&&{opacity:.45}]} onPress={onPress}><Text style={[styles.buttonText,secondary&&{color:purple}]}>{children}</Text></TouchableOpacity>}
export default function App(){
  const pendingPunch=useRef(null);
  const [token,setToken]=useState(null),[ready,setReady]=useState(false),[company,setCompany]=useState(''),[username,setUsername]=useState(''),[password,setPassword]=useState('');
  const [me,setMe]=useState(null),[records,setRecords]=useState([]),[requests,setRequests]=useState([]),[busy,setBusy]=useState(false),[tab,setTab]=useState('attendance'),[tracking,setTracking]=useState(false),[hasPending,setHasPending]=useState(false);
  const call=(path,method,body)=>req(path,token,method,body);
  const run=async fn=>{setBusy(true);try{await fn()}catch(e){Alert.alert('حضوریار',e.message)}finally{setBusy(false)}};
  async function reload(authToken=token){const [m,r,q]=await Promise.all([req('/api/me',authToken),req('/api/attendance',authToken),req('/api/requests?scope=mine',authToken)]);setMe(m.user);setRecords(r.items);setRequests(q.items);setTracking(await isTracking());
    const saved=await SecureStore.getItemAsync(PENDING_KEY);let pending=null;try{pending=JSON.parse(saved||'null')}catch{}
    if(pending?.company_id===m.user.company_id&&pending?.user_id===m.user.id){pendingPunch.current=pending.payload;setHasPending(true)}else{pendingPunch.current=null;setHasPending(false);}}
  useEffect(()=>{(async()=>{try{const saved=await SecureStore.getItemAsync('hozoryar_token');if(saved){setToken(saved);await reload(saved)}}catch{await SecureStore.deleteItemAsync('hozoryar_token');setToken(null)}finally{setReady(true)}})()},[]);
  async function login(){const result=await req('/api/login',null,'POST',{company,username,password});await SecureStore.setItemAsync('hozoryar_token',result.token);setToken(result.token);setPassword('');await reload(result.token);}
  async function logout(){if(hasPending)throw Error('ابتدا تردد در انتظار ارسال را تعیین تکلیف کنید؛ خروج از حساب صف ارسال را پاک نمی‌کند.');try{await call('/api/logout','POST')}finally{pendingPunch.current=null;await stopTracking();await SecureStore.deleteItemAsync('hozoryar_token');setToken(null);setMe(null);setRecords([]);setTracking(false)}}
  async function getPosition(){const result=await Location.requestForegroundPermissionsAsync();if(result.status!=='granted')throw Error('دسترسی موقعیت داده نشده است');const p=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});return {lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}}
  const active=records.find(r=>!r.checked_out_at);
  async function punch(){const action=active?'out':'in';
    // Reuse the same id after a timeout: the server can safely replay a committed punch.
    if(!pendingPunch.current){const event_id=`punch_${Date.now()}_${Math.random().toString(36).slice(2,14)}`;
      pendingPunch.current={action,event_id,...(action==='in'?await getPosition():{})};
      await SecureStore.setItemAsync(PENDING_KEY,JSON.stringify({company_id:me.company_id,user_id:me.id,payload:pendingPunch.current}));setHasPending(true);}
    await call('/api/attendance','POST',pendingPunch.current);
    const sentAction=pendingPunch.current.action;pendingPunch.current=null;await SecureStore.deleteItemAsync(PENDING_KEY);setHasPending(false);
    if(sentAction==='out'){await stopTracking();setTracking(false)}await reload();Alert.alert('ثبت شد',sentAction==='out'?'خروج شما ثبت شد':'ورود شما ثبت شد')}
  async function discardPending(){Alert.alert('حذف تردد در انتظار','ممکن است درخواست قبلاً به سرور رسیده باشد. ابتدا سوابق را به‌روزرسانی کنید. حذف، تردد ثبت‌شده روی سرور را پاک نمی‌کند.',[
    {text:'انصراف',style:'cancel'},{text:'حذف صف محلی',style:'destructive',onPress:()=>run(async()=>{await SecureStore.deleteItemAsync(PENDING_KEY);pendingPunch.current=null;setHasPending(false);await reload();})}
  ]);}
  async function sendLocation(){await call('/api/location','POST',await getPosition());Alert.alert('حضوریار','موقعیت شما در نقشه زنده ثبت شد')}
  async function toggleTracking(){if(tracking){await stopTracking();setTracking(false)}else{await startTracking();setTracking(true)}}
  if(!ready)return <View style={styles.center}><ActivityIndicator color={purple} size="large"/></View>;
  return <SafeAreaView style={styles.root}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Image source={require('./assets/logo.png')} style={styles.logo}/><View><Text style={styles.title}>حضوریار</Text><Text style={styles.subtitle}>{me?.company_name||'مدیریت هوشمند پرسنل'}</Text></View></View>
    {!token?<View style={styles.card}><Text style={styles.heading}>ورود به حساب</Text><Text style={styles.label}>شناسه شرکت</Text><TextInput style={styles.input} value={company} onChangeText={setCompany} autoCapitalize="none"/><Text style={styles.label}>نام کاربری</Text><TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none"/><Text style={styles.label}>رمز عبور</Text><TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry/><Button disabled={busy} onPress={()=>run(login)}>ورود</Button></View>:
    <><View style={styles.card}><Text style={styles.greeting}>{me?.name} عزیز، خوش آمدید</Text><Text style={styles.note}>موقعیت فقط با اقدام شما و هنگام حضور فعال به سرور ارسال می‌شود.</Text><View style={styles.tabs}><TouchableOpacity onPress={()=>setTab('attendance')} style={[styles.tab,tab==='attendance'&&styles.tabActive]}><Text>حضور من</Text></TouchableOpacity><TouchableOpacity onPress={()=>setTab('requests')} style={[styles.tab,tab==='requests'&&styles.tabActive]}><Text>درخواست‌ها</Text></TouchableOpacity></View></View>
      {tab==='attendance'?<View style={styles.card}><Text style={styles.heading}>{active?'در حال حضور':'حضور فعال ندارید'}</Text>{hasPending&&<View style={styles.pending} accessibilityRole="alert"><Text style={styles.pendingText}>تردد قبلی در انتظار تأیید سرور است. با اتصال اینترنت، «تلاش مجدد» را بزنید؛ همان شناسه برای جلوگیری از ثبت تکراری ارسال می‌شود. زمان ثبت، زمان دریافت سرور خواهد بود.</Text><Button secondary disabled={busy} onPress={discardPending}>لغو صف پس از بررسی سوابق</Button></View>}<Button disabled={busy} onPress={()=>run(punch)}>{hasPending?'تلاش مجدد برای ثبت تردد قبلی':active?'ثبت خروج':'ثبت ورود با GPS'}</Button>{active&&<Button secondary disabled={busy} onPress={()=>run(sendLocation)}>ارسال موقعیت فعلی</Button>}{active&&<Button secondary disabled={busy} onPress={()=>run(toggleTracking)}>{tracking?'توقف پایش پس‌زمینه':'فعال‌کردن اختیاری پایش پس‌زمینه'}</Button>}<Text style={styles.note}>پایش پس‌زمینه فقط با اجازه شما فعال می‌شود و اعلان دائمی اندروید دارد. زمان‌بندی ارسال در همه گوشی‌ها تضمین‌شده نیست.</Text><Text style={styles.heading}>سوابق اخیر</Text>{records.slice(0,15).map(r=><View key={r.id} style={styles.row}><Text style={styles.item}>{new Date(r.checked_in_at).toLocaleString('fa-IR')}</Text><Text style={styles.note}>{r.checked_out_at?'خروج: '+new Date(r.checked_out_at).toLocaleString('fa-IR'):'حاضر'}</Text></View>)}</View>:
      <View style={styles.card}><Text style={styles.heading}>درخواست‌های من</Text>{requests.map(r=><View key={r.id} style={styles.row}><Text style={styles.item}>{r.type==='mission'?'مأموریت':'مرخصی'} · {r.work_date}</Text><Text style={styles.note}>{r.minutes} دقیقه · {r.status==='approved'?'تأیید':r.status==='rejected'?'رد':'در انتظار'}</Text></View>)}{requests.length===0&&<Text style={styles.note}>درخواستی ثبت نشده است.</Text>}</View>}
      <Button secondary disabled={busy} onPress={()=>run(()=>reload())}>به‌روزرسانی</Button><Button secondary disabled={busy} onPress={()=>run(logout)}>خروج از حساب</Button></>}
  </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:'#F5F3FF'},content:{padding:20,paddingBottom:50,gap:16},center:{flex:1,alignItems:'center',justifyContent:'center'},header:{flexDirection:'row-reverse',alignItems:'center',gap:14,marginVertical:14},logo:{width:80,height:80,borderRadius:18},title:{fontSize:29,fontWeight:'900',color:purple,textAlign:'right'},subtitle:{color:muted,textAlign:'right'},card:{backgroundColor:'white',padding:20,borderRadius:20,gap:14,borderWidth:1,borderColor:'#E8DFFF'},heading:{fontWeight:'800',fontSize:20,color:ink,textAlign:'right'},greeting:{fontSize:17,fontWeight:'700',color:ink,textAlign:'right'},label:{textAlign:'right',color:ink},input:{borderWidth:1,borderColor:'#DED5EC',borderRadius:12,padding:12,textAlign:'right',minHeight:48,color:ink},button:{backgroundColor:purple,minHeight:50,borderRadius:12,alignItems:'center',justifyContent:'center',paddingHorizontal:16},secondary:{backgroundColor:'#EFE7FF',borderWidth:1,borderColor:'#DBC7FF'},buttonText:{color:'white',fontSize:15,fontWeight:'800'},tabs:{flexDirection:'row-reverse',gap:10},tab:{flex:1,padding:14,borderRadius:12,backgroundColor:'#F1EDFA',alignItems:'center'},tabActive:{backgroundColor:'#DCCBFF'},row:{borderBottomWidth:1,borderColor:'#EEE8F5',paddingBottom:10,gap:5},item:{textAlign:'right',fontWeight:'700',color:ink},note:{textAlign:'right',color:muted,lineHeight:22},pending:{backgroundColor:'#FFF7E6',padding:12,borderRadius:12,borderWidth:1,borderColor:'#E3BB72',gap:10},pendingText:{textAlign:'right',lineHeight:24,color:'#643A08'}});
