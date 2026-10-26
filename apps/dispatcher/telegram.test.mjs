import test from 'node:test';
import assert from 'node:assert/strict';
import {createTelegramController} from './telegram-core.mjs';
import {createTelegramApi} from './telegram.mjs';
const stamp=Date.now();
function fixture({paired=true,provider,saveState}={}){
 const state={owner:paired?{chatId:11,userId:22}:null,offset:0};
 const sent=[],calls=[];
 const telegram=async(method,body)=>{sent.push({method,body});return {};};
 const dispatcher=async(path,body)=>{calls.push({path,body});return provider?provider(path,body):{reply:'Уточните адрес.',canSave:false,draftToken:null};};
 const controller=createTelegramController({state,saveState:saveState||(async()=>{}),telegram,dispatcher,pairCode:'test-pair-code',now:()=>stamp});
 const update=(text,overrides={})=>({message:{chat:{id:11,type:'private'},from:{id:22},text,date:Math.floor(stamp/1000),...overrides}});
 return {state,sent,calls,controller,update};
}
test('unpaired chats do not send messages or call Claude',async()=>{const f=fixture({paired:false});await f.controller.handle(f.update('hello'));assert.equal(f.sent.length,0);assert.equal(f.calls.length,0);});
test('exact pairing command registers only its private sender',async()=>{const f=fixture({paired:false});await f.controller.handle(f.update('/start test-pair-code'));assert.deepEqual(f.state.owner,{chatId:11,userId:22});assert.equal(f.sent[0].method,'sendMessage');});
test('wrong or stale pairing command is ignored',async()=>{const f=fixture({paired:false});await f.controller.handle(f.update('/start wrong'));await f.controller.handle(f.update('/start test-pair-code',{date:Math.floor(stamp/1000)-120}));assert.equal(f.state.owner,null);assert.equal(f.sent.length,0);});
test('pair persistence failure does not leave chat authorized',async()=>{const f=fixture({paired:false,saveState:async()=>{throw Error('disk');}});await assert.rejects(f.controller.handle(f.update('/start test-pair-code')),/state_write/);assert.equal(f.state.owner,null);assert.equal(f.sent.length,0);});
test('other chats users and groups never reach dispatcher',async()=>{const f=fixture();await f.controller.handle(f.update('hello',{chat:{id:33,type:'private'}}));await f.controller.handle(f.update('hello',{from:{id:44}}));await f.controller.handle(f.update('hello',{chat:{id:11,type:'group'}}));assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);});
test('paired text reaches local dispatcher and receives its reply',async()=>{const f=fixture();await f.controller.handle(f.update('Учебные коробки'));assert.equal(f.calls[0].path,'/api/chat');assert.equal(f.sent[0].body.text,'Уточните адрес.');});
test('new command clears history',async()=>{const f=fixture();await f.controller.handle(f.update('Первая заявка'));await f.controller.handle(f.update('/new'));await f.controller.handle(f.update('Вторая заявка'));assert.equal(f.calls[1].body.messages.length,1);});
test('only completed server draft can be saved',async()=>{const f=fixture({provider:async(path)=>path==='/api/orders'?{order:{id:'Z000001'}}:{reply:'Черновик собран.',canSave:true,draftToken:'server-token',summary:{cargo:'Учебные коробки'}}});await f.controller.handle(f.update('Заявка'));await f.controller.handle(f.update('/save'));assert.deepEqual(f.calls[1],{path:'/api/orders',body:{draftToken:'server-token'}});assert.match(f.sent.at(-1).body.text,/Z000001/);});
test('incomplete request cannot be saved',async()=>{const f=fixture();await f.controller.handle(f.update('Заявка'));await f.controller.handle(f.update('/save'));assert.equal(f.calls.length,1);});
test('correction invalidates old draft even if new provider request fails',async()=>{let fail=false;const f=fixture({provider:async()=>{if(fail)throw Error('network');return {reply:'Черновик',canSave:true,draftToken:'old',summary:{}};}});await f.controller.handle(f.update('Заявка'));fail=true;await f.controller.handle(f.update('Изменить вес'));await f.controller.handle(f.update('/save'));assert.equal(f.calls.filter(c=>c.path==='/api/orders').length,0);});
test('nontext messages get explanation without Claude request',async()=>{const f=fixture();await f.controller.handle(f.update(undefined));assert.equal(f.calls.length,0);assert.match(f.sent[0].body.text,/только текст/);});
test('transport uses POST and cannot call undeclared methods',async()=>{let request;const api=createTelegramApi('123456:'+ 'a'.repeat(30),{fetchImpl:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({ok:true,result:{id:1}})};}});await api('getMe');assert.equal(request.options.method,'POST');await assert.rejects(api('deleteWebhook'),/method_forbidden/);});
test('transport errors never expose token',async()=>{const token='123456:'+ 'b'.repeat(30);const api=createTelegramApi(token,{fetchImpl:async()=>{throw Error('secret '+token);}});await assert.rejects(api('getMe'),e=>e.message==='telegram_network'&&!e.message.includes(token));});
