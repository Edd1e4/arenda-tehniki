import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OrderStore} from './orders.mjs';
import {createHandler} from './server.mjs';
async function fresh(){const dir=await mkdtemp(fileURLToPath(new URL('./test-data-',import.meta.url)));return {path:join(dir,'orders.json'),store:new OrderStore(join(dir,'orders.json'))};}
const summary={cargo:'Учебные коробки',pickup:'Учебный адрес А',dropoff:'Учебный адрес Б',date:'2099-01-01',time:'10:00',dimensions:'60 × 40 × 30 см',pieceCount:8,contact:'Учебный контакт',weightKg:300};
const draft={summary,suggestedVehicle:'Volkswagen Caddy'};
const extracted={...summary,pickupStreet:'Учебная',pickupHouse:'1',dropoffStreet:'Учебная',dropoffHouse:'2',lengthCm:60,widthCm:40,heightCm:30,zone:'',requestedVehicle:'',needsHuman:false};
const quote=o=>({revision:o.revision,status:'quoted',priceRub:3500,vehicle:'Volkswagen Caddy',notes:'Учебный расчёт',customerAgreed:false,conditionsChecked:false});
test('saved order survives new store instance',async()=>{const {store,path}=await fresh();const o=await store.create('draft-a',draft);assert.equal(o.status,'new');const list=await new OrderStore(path).list();assert.equal(list[0].summary.weightKg,300);assert.ok(!('draftToken' in list[0]));});
test('concurrent repeated save creates exactly one order',async()=>{const {store}=await fresh();const [a,b]=await Promise.all([store.create('same',draft),store.create('same',draft)]);assert.equal(a.id,b.id);assert.equal((await store.list()).length,1);});
test('different drafts get distinct ids',async()=>{const {store}=await fresh();const a=await store.create('a',draft),b=await store.create('b',draft);assert.notEqual(a.id,b.id);});
test('stale revision cannot overwrite another edit',async()=>{const {store}=await fresh();const o=await store.create('a',draft);await store.update(o.id,quote(o));await assert.rejects(store.update(o.id,quote(o)),/order_conflict/);});
test('confirmation requires quoted state and human checks',async()=>{const {store}=await fresh();const o=await store.create('a',draft);await assert.rejects(store.update(o.id,{...quote(o),status:'confirmed',customerAgreed:true,conditionsChecked:true}),/invalid_transition/);const q=await store.update(o.id,quote(o));await assert.rejects(store.update(q.id,{...quote(q),status:'confirmed'}),/confirmation_required/);const c=await store.update(q.id,{...quote(q),status:'confirmed',customerAgreed:true,conditionsChecked:true});assert.equal(c.status,'confirmed');});
test('changing confirmed price requires renewed agreement',async()=>{const {store}=await fresh();let o=await store.create('a',draft);o=await store.update(o.id,quote(o));o=await store.update(o.id,{...quote(o),status:'confirmed',customerAgreed:true,conditionsChecked:true});await assert.rejects(store.update(o.id,{...quote(o),status:'confirmed',priceRub:4000,customerAgreed:true,conditionsChecked:true}),/reconfirmation_required/);o=await store.update(o.id,{...quote(o),priceRub:4000});assert.equal(o.customerAgreed,false);assert.equal(o.conditionsChecked,false);});
test('invalid prices are rejected',async()=>{const {store}=await fresh();const o=await store.create('a',draft);for(const priceRub of [-1,0,1.5,'3500',Infinity])await assert.rejects(store.update(o.id,{...quote(o),priceRub}),/invalid_price/);});
test('corrupt store is not silently replaced',async()=>{const {store,path}=await fresh();await writeFile(path,'BROKEN');await assert.rejects(store.create('a',draft),/store_unavailable/);assert.equal(await readFile(path,'utf8'),'BROKEN');});
async function client(store,provider=async()=>extracted){
 const handler=createHandler({store,provider,apiKey:'private-test-key',model:'test-model'});
 return async(method,path,body,origin='http://127.0.0.1:4388')=>{
 const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url:path,headers:{host:'127.0.0.1:4388',origin,'content-type':'application/json'}});
 let status,data;await handler(req,{writeHead(s){status=s;},end(d){data=String(d);}});
 return {status,data:JSON.parse(data)};
 };
}
test('complete draft saves server snapshot ignoring forged client fields',async()=>{const {store}=await fresh();const request=await client(store);const chat=await request('POST','/api/chat',{messages:[{role:'user',content:'Учебная заявка'}]});assert.equal(chat.data.canSave,true);const saved=await request('POST','/api/orders',{draftToken:chat.data.draftToken,priceRub:1,summary:{cargo:'FORGED'}});assert.equal(saved.status,201);assert.equal(saved.data.order.summary.cargo,summary.cargo);assert.equal(saved.data.order.priceRub,null);assert.equal(saved.data.order.status,'new');const repeated=await request('POST','/api/orders',{draftToken:chat.data.draftToken});assert.equal(repeated.data.order.id,saved.data.order.id);});
test('incomplete draft has no save token',async()=>{const {store}=await fresh();const request=await client(store,async()=>({...extracted,heightCm:null}));const chat=await request('POST','/api/chat',{messages:[{role:'user',content:'Учебная заявка'}]});assert.equal(chat.data.canSave,false);assert.equal(chat.data.draftToken,null);assert.equal((await store.list()).length,0);});
test('unknown token never creates order',async()=>{const {store}=await fresh();const request=await client(store);const r=await request('POST','/api/orders',{draftToken:'invented'});assert.equal(r.status,410);assert.equal((await store.list()).length,0);});
test('other origins cannot save or read orders',async()=>{const {store}=await fresh();const request=await client(store);for(const method of ['GET','POST']){const r=await request(method,'/api/orders',{},'https://other.example');assert.equal(r.status,403);}});
test('journal remains usable without Claude key',async()=>{const {store}=await fresh();let status;await createHandler({store,apiKey:'',model:''})({method:'GET',url:'/api/orders',headers:{host:'127.0.0.1:4388'}},{writeHead(s){status=s;},end(){}});assert.equal(status,200);});
