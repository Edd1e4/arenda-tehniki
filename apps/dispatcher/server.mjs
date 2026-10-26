import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {extractIntake,composeReply,validateMessages} from './claude.mjs';
import {reviewIntake} from './intake.mjs';
function todayMoscow(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(t=>p.find(v=>v.type===t).value).join('-');}
const errors={schema_complexity:'Claude отклонил сложность схемы заявки. Нужна проверка настроек программы.',insufficient_balance:'На API-аккаунте Claude недостаточно средств. Проверьте баланс в панели Claude.',not_configured:'Нужно добавить ключ Claude и название модели на стороне сервера.',invalid_key:'Claude не принял ключ. Проверьте ключ в настройках сервера.',provider_limit:'Достигнут лимит Claude. Попробуйте позже.',provider_config:'Проверьте название модели, доступ к ней, версию API и настройки рабочего пространства.',provider_unavailable:'Claude временно недоступен. Попробуйте позже.',invalid_messages:'Разговор слишком длинный или некорректный. Начните заново.',invalid_response:'Ответ Claude не удалось проверить. Попробуйте ещё раз.',incomplete_response:'Claude не завершил ответ. Попробуйте ещё раз.'};
export function createHandler({provider=extractIntake,apiKey=process.env.ANTHROPIC_API_KEY,model=process.env.CLAUDE_MODEL,workspaceId=process.env.ANTHROPIC_WORKSPACE_ID}={}){
 let windowStart=Date.now(),count=0,busy=false;
 return async(req,res)=>{
 const host=req.headers.host;
 const allowedHost=/^(127\.0\.0\.1|localhost):\d+$/.test(host||'');
 const origin=req.headers.origin;
 const safeOrigin=!origin||origin==='http://'+host;
 const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
 if(!allowedHost||!safeOrigin){send(403,{error:'Запрос доступен только с локальной страницы.'});return;}
 if(req.method==='GET'&&req.url==='/'){
 try{const html=await readFile(new URL('./chat.html',import.meta.url));res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});res.end(html);}catch{send(500,{error:'Не найдена страница диалога.'});}return;}
 if(req.method!=='POST'||req.url!=='/api/chat'){send(404,{error:'Страница не найдена.'});return;}
 if(!origin||req.headers['content-type']?.split(';')[0]!=='application/json'){send(403,{error:'Откройте локальную страницу диалога.'});return;}
 if(!apiKey||!model){send(503,{error:errors.not_configured});return;}
 if(Date.now()-windowStart>60000){windowStart=Date.now();count=0;}
 if(busy||count>=12){send(429,{error:'Слишком много запросов. Подождите минуту.'});return;}
 count++;busy=true;
 try{
 let size=0,parts=[];
 for await(const chunk of req){size+=chunk.length;if(size>50000){send(413,{error:'Сообщение слишком большое.'});return;}parts.push(chunk);}
 let body;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{send(400,{error:'Некорректный запрос.'});return;}
 let messages;try{messages=validateMessages(body.messages);}catch{send(400,{error:errors.invalid_messages});return;}
 const today=todayMoscow();
 const intake=await provider(messages,{apiKey,model,today,workspaceId});
 const review=reviewIntake(intake,{today});
 send(200,{reply:composeReply(review),summary:review.summary,suggestedVehicle:review.suggestedVehicle,bookingConfirmed:false,smsSent:false});
 }catch(e){send(502,{error:errors[e.message]||'Не удалось получить ответ. Проверьте подключение и попробуйте ещё раз.'});}finally{busy=false;}
 };
}
export function createApp(options){return http.createServer(createHandler(options));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4388);
 createApp().listen(port,'127.0.0.1',()=>console.log('Локальный диалог: http://127.0.0.1:'+port));
}
