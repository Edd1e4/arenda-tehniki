import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createTelegramController} from './telegram-core.mjs';
export function createTelegramApi(token,{fetchImpl=fetch,signal}={}){
 if(!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token||''))throw Error('token_missing');
 return async(method,body={})=>{
  if(!['getMe','getUpdates','getWebhookInfo','sendMessage','answerCallbackQuery'].includes(method))throw Error('method_forbidden');
  let r;try{r=await fetchImpl('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(40000)]):AbortSignal.timeout(40000)});}catch{throw Error('telegram_network');}
  let d;try{d=await r.json();}catch{throw Error('telegram_network');}
  if(!r.ok||!d.ok)throw Error(d.error_code===401?'token_invalid':d.error_code===409?'telegram_conflict':'telegram_api');
  return d.result;
 };
}
export async function runTelegram(){
 const token=(process.env.TELEGRAM_BOT_TOKEN||'').trim();
 const abort=new AbortController();process.once('SIGINT',()=>abort.abort());
 const api=createTelegramApi(token,{signal:abort.signal});
 const base='http://127.0.0.1:4388';
 async function dispatcher(path,body){
  let response;try{response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify(body),signal:AbortSignal.timeout(40000)});}catch{throw Error('dispatcher_unavailable');}
  if(!response.ok)throw Error('dispatcher_unavailable');return response.json();
 }
 try{const response=await fetch(base,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error();}catch{throw Error('dispatcher_unavailable');}
 const me=await api('getMe');const webhook=await api('getWebhookInfo');
 if(webhook.url)throw Error('webhook_exists');
 const statePath=new URL('./data/telegram-state.json',import.meta.url);
 let state;
 try{state=JSON.parse(await readFile(statePath,'utf8'));if(state.botId!==me.id||!Number.isSafeInteger(state.offset)||state.owner&&(!Number.isSafeInteger(state.owner.chatId)||!Number.isSafeInteger(state.owner.userId)))throw Error('state_invalid');}
 catch(e){if(e.code!=='ENOENT')throw Error('state_invalid');state={botId:me.id,offset:0,owner:null};}
 async function saveState(){await mkdir(dirname(fileURLToPath(statePath)),{recursive:true});const temp=fileURLToPath(statePath)+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(state),{mode:0o600,flag:'wx'});await rename(temp,statePath);}
 const code=randomBytes(12).toString('hex');
 const controller=createTelegramController({state,saveState,telegram:api,dispatcher,pairCode:code});
 console.log('Бот: @'+me.username);
 if(!state.owner){console.log('Откройте своего бота в Telegram и отправьте в течение 10 минут:');console.log('/start '+code);}
 else console.log('Личный тест подключён. Отправьте боту /new.');
 console.log('Оба окна программ должны оставаться открытыми. Для остановки: Ctrl+C.');
 while(!abort.signal.aborted){
  try{
   const updates=await api('getUpdates',{offset:state.offset,timeout:25,limit:20,allowed_updates:['message','callback_query']});
   for(const update of updates){
    if(abort.signal.aborted)break;
    await controller.handle(update);state.offset=update.update_id+1;await saveState();
   }
  }catch(e){
   if(abort.signal.aborted)break;
   if(['token_invalid','telegram_conflict','state_write'].includes(e.message))throw e;
   console.log('Связь временно недоступна. Повтор через 5 секунд.');
   await new Promise(r=>setTimeout(r,5000));
  }
 }
}
const errors={token_missing:'В файле .env.telegram нет корректного токена.',token_invalid:'Telegram не принял токен. Проверьте его в .env.telegram.',telegram_conflict:'Бот уже запущен в другом окне или сервисе. Остановите вторую копию.',telegram_network:'Нет связи с Telegram. Проверьте интернет.',telegram_api:'Telegram отклонил запрос. Проверьте токен и доступность сервиса.',dispatcher_unavailable:'Сначала запустите локальный диспетчер на порту 4388 и оставьте его окно открытым.',webhook_exists:'У этого бота уже есть другое подключение. Оно не изменено; сначала уточните, где бот используется.',state_invalid:'Не удалось прочитать настройки личного теста или токен относится к другому боту. Файл состояния не изменён.',state_write:'Не удалось сохранить настройки подключения.'};
export function telegramErrorMessage(error){return errors[error?.message]||'Не удалось подключить Telegram. Токен и настройки не выводятся.';}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){runTelegram().catch(e=>{console.error(errors[e.message]||'Не удалось запустить Telegram. Настройки и токен не выводятся.');process.exitCode=1;});}
