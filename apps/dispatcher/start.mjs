import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createApp} from './server.mjs';
import {runTelegram,telegramErrorMessage} from './telegram.mjs';
export async function runCombined({loadConfig=loadEnvFile,createServer=createApp,telegram=runTelegram,env=process.env,log=console.log,waitForStop=()=>new Promise(r=>process.once('SIGINT',r))}={}){
 try{loadConfig(fileURLToPath(new URL('./.env',import.meta.url)));loadConfig(fileURLToPath(new URL('./.env.telegram',import.meta.url)));}catch{throw Error('settings_missing');}
 if(!env.ANTHROPIC_API_KEY||!env.CLAUDE_MODEL||!env.TELEGRAM_BOT_TOKEN)throw Error('settings_incomplete');
 const server=createServer();
 try{
  await new Promise((resolve,reject)=>{
   const failed=error=>reject(error);server.once('error',failed);
   server.listen(4388,'127.0.0.1',()=>{server.removeListener('error',failed);resolve();});
  });
 }catch(e){if(e.code==='EADDRINUSE')throw Error('port_busy');throw Error('server_start');}
 log('Диспетчер запущен: http://127.0.0.1:4388');
 log('Журнал заявок: http://127.0.0.1:4388/orders');
 log('Подключаем Telegram. Оставьте это одно окно открытым.');
 try{await telegram();}
 catch(e){
  log(telegramErrorMessage(e));
  log('Диспетчер продолжает работать. Для повторного запуска нажмите Ctrl+C и повторите команду.');
  await waitForStop();
 }finally{
  server.closeAllConnections?.();
  await new Promise(r=>server.close(r));
 }
}
const messages={settings_missing:'Не найдены файлы .env и .env.telegram рядом с программой. Настройки не изменены.',settings_incomplete:'В настройках не заполнен ключ Claude, модель или токен Telegram.',port_busy:'Порт 4388 уже занят. В прежнем окне диспетчера нажмите Ctrl+C, затем повторите эту команду.',server_start:'Не удалось запустить локальный диспетчер.'};
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runCombined().catch(e=>{console.error(messages[e.message]||'Не удалось запустить программы. Настройки и ключи не выводятся.');process.exitCode=1;});
}
