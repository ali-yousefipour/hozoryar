const base=require('./app.json').expo;
module.exports=()=>({...base,extra:{...base.extra,apiBaseUrl:process.env.HOZORYAR_API_BASE_URL||base.extra.apiBaseUrl}});
