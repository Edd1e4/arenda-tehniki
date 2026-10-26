// Telegram test adapter. Sends only to the explicitly paired private chat.
export function createTelegramController({state,saveState,telegram,dispatcher,pairCode,now=Date.now}){
 const sessions=new Map();const pairUntil=now()+10*60*1000;
 const authorized=(chat,user)=>state.owner&&chat?.type==='private'&&chat.id===state.owner.chatId&&user?.id===state.owner.userId;
 const tell=(chat,text,markup)=>telegram('sendMessage',{chat_id:chat.id,text:text.slice(0,4000),...(markup?{reply_markup:markup}:{})});
 const welcome='Я ИИ-помощник Аренда24 МО. Это личный тест: сообщения передаются в Claude и расходуют API-баланс. Пока используйте учебные данные. Что нужно перевезти?\n/new — новая заявка; /save — сохранить готовый черновик; /help — помощь.';
 async function save(chat,s){
  if(!s?.draftToken){await tell(chat,'Готового черновика пока нет. Сначала уточните данные заявки.');return;}
  try{
   const d=await dispatcher('/api/orders',{draftToken:s.draftToken});
   s.savedId=d.order.id;
   await tell(chat,'Заявка '+d.order.id+' сохранена в локальном журнале. Цена и бронирование не подтверждены, СМС не отправлено.');
  }catch{await tell(chat,'Не удалось сохранить заявку. Проверьте, что локальный сервер работает. Если он перезапускался, подготовьте черновик заново.');}
 }
 return {async handle(update){
  const message=update.message;const callback=update.callback_query;
  const chat=message?.chat||callback?.message?.chat;const user=message?.from||callback?.from;
  if(!chat||chat.type!=='private'||!user||user.is_bot)return;
  if(!state.owner){
   if(!message||message.date*1000<pairUntil-10*60*1000-30000||now()>pairUntil||message.text!=='/start '+pairCode)return;
   state.owner={chatId:chat.id,userId:user.id};
   try{await saveState();}catch{state.owner=null;throw Error('state_write');}
   await tell(chat,'Личный тест подключён. '+welcome);return;
  }
  if(!authorized(chat,user))return;
  let s=sessions.get(chat.id);
  if(s&&now()-s.touched>60*60*1000){sessions.delete(chat.id);s=null;}
  if(callback){
   if(s?.draftToken&&callback.data==='save:'+s.draftToken){await telegram('answerCallbackQuery',{callback_query_id:callback.id});await save(chat,s);}
   else await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:'Этот черновик устарел. Используйте последнюю заявку.'});
   return;
  }
  const text=message.text?.trim();
  if(!text){await tell(chat,'Пока принимаю только текст. Опишите груз и маршрут сообщением.');return;}
  if(['/start','/new'].includes(text)){
   sessions.set(chat.id,{messages:[],draftToken:null,touched:now()});await tell(chat,welcome);return;
  }
  if(text==='/help'){await tell(chat,'Опишите груз, вес, размеры, количество мест, адреса, дату, время и контакт. /new — начать заново. /save — сохранить готовую заявку в журнал. Только личный тест, приём клиентов ещё не включён.');return;}
  if(text==='/save'){await save(chat,s);return;}
  if(!s){s={messages:[],draftToken:null,touched:now()};sessions.set(chat.id,s);}
  s.touched=now();s.draftToken=null;s.savedId=null;
  if(text.length>4000){await tell(chat,'Сообщение слишком длинное. Сократите его до 4000 символов.');return;}
  if(s.messages.length>=24){await tell(chat,'Достигнут лимит пробного диалога. Начните новую заявку командой /new.');return;}
  try{
   const data=await dispatcher('/api/chat',{messages:[...s.messages,{role:'user',content:text}]});
   s.messages.push({role:'user',content:text},{role:'assistant',content:data.reply});
   s.draftToken=data.canSave?data.draftToken:null;
   if(!s.draftToken){await tell(chat,data.reply);return;}
   const labels={cargo:'Груз',pickup:'Откуда',dropoff:'Куда',date:'Дата',time:'Время (Москва)',dimensions:'Размеры',pieceCount:'Мест',weightKg:'Вес, кг',contact:'Контакт'};
   const summary=Object.entries(labels).map(([k,label])=>label+': '+(data.summary[k]||'не уточнено')).join('\n');
   await tell(chat,data.reply+'\n\nПроверьте черновик:\n'+summary+'\n\nДля сохранения нажмите кнопку или отправьте /save.',{inline_keyboard:[[{text:'Сохранить заявку',callback_data:'save:'+s.draftToken}]]});
  }catch{await tell(chat,'Ответ не получен. Проверьте сообщение об ошибке в локальном диалоге на компьютере и попробуйте ещё раз. Заявка не сохранена.');}
 }};
}
