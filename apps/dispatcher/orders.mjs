import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const transitions={new:['new','quoted','cancelled'],quoted:['quoted','confirmed','cancelled'],confirmed:['confirmed','quoted','completed','cancelled'],completed:['completed'],cancelled:['cancelled']};
export class OrderStore{
 constructor(path){this.path=path;this.queue=Promise.resolve();}
 async read(){
  try{const data=JSON.parse(await readFile(this.path,'utf8'));if(data.version!==1||!Number.isSafeInteger(data.nextNumber)||!Array.isArray(data.orders))throw Error('store_corrupt');return data;}
  catch(e){if(e.code==='ENOENT')return {version:1,nextNumber:1,orders:[]};throw Error('store_unavailable');}
 }
 async write(data){await mkdir(dirname(this.path),{recursive:true});const temp=this.path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});await rename(temp,this.path);}
 async list(){await this.queue;return (await this.read()).orders.map(({draftToken,...order})=>order).reverse();}
 run(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result;}
 create(draftToken,draft){return this.run(async()=>{
  const data=await this.read();const prior=data.orders.find(o=>o.draftToken===draftToken);if(prior){const {draftToken:_,...publicOrder}=prior;return publicOrder;}
  const now=new Date().toISOString();
  const order={id:'Z'+String(data.nextNumber++).padStart(6,'0'),revision:1,draftToken,createdAt:now,updatedAt:now,status:'new',summary:structuredClone(draft.summary),suggestedVehicle:draft.suggestedVehicle,vehicle:'',priceRub:null,notes:'',customerAgreed:false,conditionsChecked:false};
  data.orders.push(order);await this.write(data);const {draftToken:_,...publicOrder}=order;return publicOrder;
 });}
 update(id,input){return this.run(async()=>{
  const data=await this.read();const order=data.orders.find(o=>o.id===id);if(!order)throw Error('order_not_found');
  if(!input||input.revision!==order.revision)throw Error('order_conflict');
  const status=input.status;
  if(!transitions[order.status]?.includes(status))throw Error('invalid_transition');
  const price=input.priceRub;
  if(price!==null&&(!Number.isSafeInteger(price)||price<=0||price>100000000))throw Error('invalid_price');
  if(typeof input.notes!=='string'||input.notes.length>2000)throw Error('invalid_notes');
  if(!['','Ford Transit','Volkswagen Caddy','Манипулятор','JCB 3CX','Bobcat S185'].includes(input.vehicle))throw Error('invalid_vehicle');
  if(typeof input.customerAgreed!=='boolean'||typeof input.conditionsChecked!=='boolean')throw Error('invalid_confirmation');
  if(['quoted','confirmed','completed'].includes(status)&&(!price||!input.vehicle))throw Error('confirmation_required');
  if(['confirmed','completed'].includes(status)){
   if(!price||!input.vehicle||!input.customerAgreed||!input.conditionsChecked)throw Error('confirmation_required');
   if(order.status==='confirmed'&&(price!==order.priceRub||input.vehicle!==order.vehicle))throw Error('reconfirmation_required');
  }
  if(['completed','cancelled'].includes(order.status)&&(price!==order.priceRub||input.vehicle!==order.vehicle))throw Error('terminal_order');
  Object.assign(order,{status,priceRub:price,vehicle:input.vehicle,notes:input.notes,customerAgreed:['confirmed','completed'].includes(status)&&input.customerAgreed,conditionsChecked:['confirmed','completed'].includes(status)&&input.conditionsChecked,updatedAt:new Date().toISOString(),revision:order.revision+1});
  await this.write(data);const {draftToken:_,...publicOrder}=order;return publicOrder;
 });}
}
