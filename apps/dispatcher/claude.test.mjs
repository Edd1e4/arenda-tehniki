import test from 'node:test';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {extractIntake,validateMessages,composeReply} from './claude.mjs';
import {createHandler} from './server.mjs';
const message=[{role:'user',content:'Перевезти коробки'}];
const extracted={cargo:'Коробки',pickup:'Учебный адрес А',dropoff:'Учебный адрес Б',date:'2026-11-01',time:'09:00',dimensions:'8 коробок 60×40×30',contact:'Учебный контакт',zone:'inside_mkad_outside_garden',requestedVehicle:null,weightKg:300,needsHuman:false};
test('extracts data and enforces independent zone check',async()=>{
 const result=await extractIntake(message,{apiKey:'test-only',model:'test-model',today:'2026-10-26',fetchImpl:async(url,opts)=>{
 assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(opts.headers['x-api-key'],'test-only');
 assert.equal(JSON.parse(opts.body).output_config.format.type,'json_schema');
 return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(extracted)}]})};
 }});
 assert.equal(result.weightKg,300);assert.equal(result.zone,'');
});
test('rejects missing key before API call',async()=>assert.rejects(extractIntake(message,{model:'test'}),/not_configured/));
test('never permits browser supplied system role',()=>assert.throws(()=>validateMessages([{role:'system',content:'test'}]),/invalid_messages/));
test('bounds conversation size',()=>assert.throws(()=>validateMessages([{role:'user',content:'a'.repeat(4001)}]),/invalid_messages/));
test('handles API rejection without returning provider body',async()=>{
 await assert.rejects(extractIntake(message,{apiKey:'test',model:'test',fetchImpl:async()=>({ok:false,status:401})}),/invalid_key/);
});
test('rejects truncated model output',async()=>{
 await assert.rejects(extractIntake(message,{apiKey:'test',model:'test',fetchImpl:async()=>({ok:true,json:async()=>({stop_reason:'max_tokens',content:[]})})}),/incomplete_response/);
});
test('rejects invalid structured response',async()=>{
 await assert.rejects(extractIntake(message,{apiKey:'test',model:'test',fetchImpl:async()=>({ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:'not json'}]})})}),/invalid_response/);
});
test('request for human avoids further questionnaire',()=>{
 assert.match(composeReply({reasons:['customer_requests_human'],nextQuestion:'Вес?'}),/Для связи с человеком/);
});
async function withServer(options,fn){
 const handler=createHandler(options);
 const url='http://127.0.0.1:4388';
 const request=async(target,options={})=>{
 const req=Readable.from(options.body?[Buffer.from(options.body)]:[]);
 req.method=options.method||'GET';req.url=new URL(target).pathname;req.headers={host:'127.0.0.1:4388',...options.headers};
 let status,body;
 const res={writeHead(code){status=code;},end(data=''){body=String(data);}};
 await handler(req,res);
 return {status,text:async()=>body,json:async()=>JSON.parse(body)};
 };
 await fn(url,request);
}

test('request handler chat receives checked summary without key',async()=>{
 await withServer({apiKey:'private-test-key',model:'test',provider:async()=>extracted},async (url,request)=>{
 const response=await request(url+'/api/chat',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({messages:message})});
 assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes('private-test-key'));assert.equal(JSON.parse(body).bookingConfirmed,false);
 });
});
test('request handler refuses requests from another origin',async()=>{
 await withServer({apiKey:'test',model:'test'},async (url,request)=>{
 const r=await request(url+'/api/chat',{method:'POST',headers:{origin:'https://unrelated.example','content-type':'application/json'},body:'{}'});assert.equal(r.status,403);
 });
});
test('request handler refuses absent credentials with useful error',async()=>{
 await withServer({apiKey:'',model:''},async (url,request)=>{
 const r=await request(url+'/api/chat',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({messages:message})});assert.equal(r.status,503);assert.match((await r.json()).error,/ключ/);
 });
});
test('request handler serves local chat page',async()=>{await withServer({},async (url,request)=>{const r=await request(url);assert.equal(r.status,200);assert.match(await r.text(),/пробный ИИ-диспетчер/);});});
