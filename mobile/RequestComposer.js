import React,{useState} from 'react';
import {View,Text,TextInput,TouchableOpacity,StyleSheet} from 'react-native';
import {requestTypes,persianDate,requestPayload} from './request-data.mjs';

export default function RequestComposer({call,run,busy,onSubmitted,dark=false}){
  const s=requestStyles(dark);
  const [type,setType]=useState('annual_leave'),[unit,setUnit]=useState('hourly');
  const [from,setFrom]=useState(persianDate()),[to,setTo]=useState(persianDate()),[minutes,setMinutes]=useState('60'),[description,setDescription]=useState('');
  const [substitute,setSubstitute]=useState(''),[candidates,setCandidates]=useState(null),[balance,setBalance]=useState(null);
  const eligible=type==='annual_leave'&&unit==='daily';
  const values=()=>({type,unit,from,to,minutes,description,substitute});
  function resetCandidates(){setCandidates(null);setSubstitute('');}
  function choice(label,key,selected,onPress){return <TouchableOpacity key={key} accessibilityRole="radio" accessibilityState={{checked:selected,disabled:busy}} disabled={busy} onPress={onPress} style={[s.choice,selected&&s.selected]}><Text style={[s.choiceText,selected&&s.selectedText]}>{label}</Text></TouchableOpacity>;}
  function input(label,value,setValue,extra={}){return <View><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} style={s.input} value={value} onChangeText={setValue} editable={!busy} {...extra}/></View>;}
  const action=(label,onPress,primary=false)=><TouchableOpacity disabled={busy} accessibilityRole="button" accessibilityState={{disabled:busy}} onPress={()=>run(onPress)} style={[s.action,primary&&s.primary,busy&&s.disabled]}><Text style={primary?s.primaryText:s.choiceText}>{label}</Text></TouchableOpacity>;
  return <View style={s.form}><Text style={s.heading}>درخواست جدید</Text><Text style={s.note}>درخواست برای حساب خودتان ثبت می‌شود و پس از بررسی مدیر نتیجه می‌گیرد.</Text>
    <Text style={s.label}>نوع درخواست</Text><View accessibilityRole="radiogroup" style={s.choices}>{Object.entries(requestTypes).map(([key,label])=>choice(label,key,type===key,()=>{setType(key);resetCandidates();}))}</View>
    <Text style={s.label}>واحد درخواست</Text><View accessibilityRole="radiogroup" style={s.choices}>{[['hourly','ساعتی'],['daily','روزانه']].map(([key,label])=>choice(label,key,unit===key,()=>{setUnit(key);setMinutes(key==='daily'?'480':'60');resetCandidates();}))}</View>
    {input(unit==='daily'?'از تاریخ (شمسی)':'تاریخ (شمسی)',from,value=>{setFrom(value);resetCandidates();},{placeholder:'۱۴۰۵/۰۹/۰۳',maxLength:10})}
    {unit==='daily'&&input('تا تاریخ (شمسی)',to,value=>{setTo(value);resetCandidates();},{placeholder:'۱۴۰۵/۰۹/۰۳',maxLength:10})}
    {input(unit==='daily'?'مدت هر روز (دقیقه)':'مدت درخواست (دقیقه)',minutes,setMinutes,{keyboardType:'number-pad',maxLength:4})}
    <Text style={s.note}>{unit==='daily'?'مدت واردشده برای هر روز بازه اعمال می‌شود. مقدار را با موظفی و سیاست شرکت هماهنگ کنید.':'ثبت ساعتی در این نسخه بر اساس مجموع دقیقه روز است و ساعت شروع و پایان دریافت نمی‌شود.'}</Text>
    {type==='annual_leave'&&action('مشاهده مانده مرخصی',async()=>{const payload=requestPayload(values());const date=new Date(payload.work_date+'T12:00:00Z');const jyear=Number(new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',timeZone:'UTC'}).format(date));setBalance(await call('/api/leave-balance?year='+jyear));})}
    {type==='annual_leave'&&balance&&<Text style={s.note}>مانده سال {balance.year}: {balance.remaining_minutes} دقیقه؛ درخواست‌های در انتظار هنوز کسر نشده‌اند.</Text>}
    {eligible&&<View style={s.form}>{action('بررسی جانشین‌های این بازه',async()=>{const payload=requestPayload({...values(),substitute:''});const result=await call('/api/substitutes?from='+payload.work_date+'&to='+payload.end_date);setCandidates(result.items);setSubstitute('');})}<Text style={s.note}>اگر سیاست محل کار جانشین را الزامی کند، انتخاب فرد مجاز لازم است.</Text>{candidates&&<View style={s.choices}>{choice('بدون جانشین','none',!substitute,()=>setSubstitute(''))}{candidates.filter(p=>p.available).map(p=>choice(p.name,p.id,substitute===String(p.id),()=>setSubstitute(String(p.id))))}</View>}{candidates&&!candidates.some(p=>p.available)&&<Text style={s.note}>جانشین در دسترسی برای این بازه یافت نشد.</Text>}</View>}
    {input('توضیحات (اختیاری)',description,setDescription,{multiline:true,maxLength:500})}
    {action(busy?'در حال ثبت…':'ثبت درخواست برای بررسی',async()=>{await call('/api/requests','POST',requestPayload(values()));setDescription('');resetCandidates();setBalance(null);await onSubmitted();},true)}
  </View>;
}
function requestStyles(dark){return StyleSheet.create({form:{gap:12},heading:{fontSize:20,fontWeight:'700',color:dark?'#F2EDF8':'#281942',textAlign:'right'},label:{textAlign:'right',color:dark?'#F2EDF8':'#281942',marginBottom:6},input:{borderWidth:1,borderColor:'#B9AEC9',borderRadius:8,padding:12,minHeight:48,textAlign:'right',color:dark?'#F2EDF8':'#281942'},choices:{flexDirection:'row-reverse',flexWrap:'wrap',gap:8},choice:{paddingHorizontal:12,paddingVertical:12,borderWidth:1,borderColor:dark?'#66517E':'#D8CFE5',borderRadius:8,minHeight:48,justifyContent:'center'},choiceText:{color:dark?'#DDD0F5':'#5724A0',textAlign:'center'},selected:{backgroundColor:'#6D28D9',borderColor:'#6D28D9'},selectedText:{color:'#fff'},note:{color:dark?'#BEB4CC':'#62556E',textAlign:'right',lineHeight:24,fontSize:13},action:{padding:14,minHeight:48,backgroundColor:dark?'#352747':'#F1EBFA',borderRadius:8,justifyContent:'center'},primary:{backgroundColor:'#6D28D9'},primaryText:{textAlign:'center',color:'#fff',fontWeight:'700'},disabled:{opacity:.5}});}
