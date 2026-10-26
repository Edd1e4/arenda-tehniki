import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {runCombined} from './start.mjs';
const env={ANTHROPIC_API_KEY:'test',CLAUDE_MODEL:'test',TELEGRAM_BOT_TOKEN:'test'};
class Server extends EventEmitter{
 constructor(events,{fail=false,defer=false}={}){super();this.events=events;this.fail=fail;this.defer=defer;}
 listen(port,host,done){this.events.push('listen');assert.equal(port,4388);assert.equal(host,'127.0.0.1');this.ready=done;if(this.fail)queueMicrotask(()=>this.emit('error',{code:'EADDRINUSE'}));else if(!this.defer)queueMicrotask(done);}
 closeAllConnections(){this.events.push('closeConnections');}
 close(done){this.events.push('close');done();}
}
test('combined start loads both files then starts dispatcher before Telegram',async()=>{
 const events=[];const server=new Server(events);
 await runCombined({env,loadConfig:path=>events.push(path.endsWith('.env.telegram')?'telegramConfig':'claudeConfig'),createServer:()=>server,telegram:async()=>events.push('telegram'),log:()=>{}});
 assert.deepEqual(events,['claudeConfig','telegramConfig','listen','telegram','closeConnections','close']);
});
test('Telegram waits for actual listening callback',async()=>{
 const events=[];const server=new Server(events,{defer:true});
 const task=runCombined({env,loadConfig:()=>{},createServer:()=>server,telegram:async()=>events.push('telegram'),log:()=>{}});
 assert.deepEqual(events,['listen']);server.ready();await task;assert.equal(events[1],'telegram');
});
test('busy port does not start a second bot',async()=>{
 const events=[];const server=new Server(events,{fail:true});
 await assert.rejects(runCombined({env,loadConfig:()=>{},createServer:()=>server,telegram:async()=>events.push('telegram'),log:()=>{}}),/port_busy/);
 assert.ok(!events.includes('telegram'));
});
test('missing settings produce safe error before creating server',async()=>{
 await assert.rejects(runCombined({env,loadConfig:()=>{throw Error('hidden details');},createServer:()=>{throw Error('not expected');}}),e=>e.message==='settings_missing');
});
test('Telegram failure keeps dispatcher alive until user stops it',async()=>{
 const events=[],logs=[];const server=new Server(events);
 await runCombined({env,loadConfig:()=>{},createServer:()=>server,telegram:async()=>{throw Error('token_invalid');},log:text=>logs.push(text),waitForStop:async()=>events.push('wait')});
 assert.deepEqual(events,['listen','wait','closeConnections','close']);assert.ok(logs.some(t=>t.includes('не принял токен')));
});
