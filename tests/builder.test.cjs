const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const helpers = require('../builder.js');
test('input accepts ZIPs within bounds and restricts module names', () => {
  helpers.validProject({ name: 'App.ZIP', size: 1024 });
  for(const file of [undefined,{ name:'app.apk',size:1024 },{ name:'app.zip',size:1 },{ name:'app.zip',size:31*1024*1024 }])assert.throws(()=>helpers.validProject(file));
  assert(helpers.validModule('app')); assert(helpers.validModule('my-app'));
  for(const module of ['app; echo secret','../app','app\nother','app:other',''])assert(!helpers.validModule(module));
});
test('signed artifact selection never returns the intermediate unsigned artifact', async () => {
  global.fetch=async()=>({ok:true,status:200,json:async()=>({artifacts:[
    {id:1,name:'native-unsigned-abc',expired:false},
    {id:2,name:'signed-android-other',expired:false},
    {id:3,name:'signed-android-abc',expired:false}
  ]})});
  assert.equal((await helpers.signedArtifact('token','Ventsharm','builder',42,'abc')).id,3);
});
test('API keeps tokens in headers, does not cache, and gives safe permission errors', async () => {
  global.fetch=async(url,options)=>{
    assert(!url.includes('private-token'));assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,'Bearer private-token');
    return {ok:false,status:403,json:async()=>({message:'denied'})};
  };
  await assert.rejects(()=>helpers.request('private-token','/user'),e=>e.status===403&&e.message.includes('Workflows'));
});
test('repository list paginates and includes only writable owned private repos', async () => {
  const pages=[];
  global.fetch=async(url)=>{pages.push(url);return{ok:true,status:200,json:async()=>new URL(url).searchParams.get('page')==='1'?Array.from({length:100},(_,i)=>({private:true,owner:{login:'someone-else'},permissions:{push:true},name:String(i)})):[
    {name:'mine',private:true,owner:{login:'Ventsharm'},permissions:{push:true}},
    {name:'public',private:false,owner:{login:'Ventsharm'},permissions:{push:true}}
  ]};};
  assert.deepEqual((await helpers.ownedPrivateRepos('token','Ventsharm')).map(r=>r.name),['mine']);assert.equal(pages.length,2);
});
test('unknown existing workflow is refused rather than overwritten', async () => {
  let writes=0;
  global.fetch=async(url,options)=>{if(options.method==='PUT')writes++;return{ok:true,status:200,json:async()=>({sha:'existing',content:Buffer.from('name: Someone else’s workflow').toString('base64')})};};
  await assert.rejects(()=>helpers.ensureWorkflow('token','owner','private','main','# Ventsharm Native Android Converter v1\nname: Converter'),/not overwritten/);
  assert.equal(writes,0);
});
test('existing Unicode workflow is compared as UTF-8 without unnecessary replacement', async () => {
  const source=fs.readFileSync('workflow.yml','utf8');let writes=0;
  global.fetch=async(url,options)=>{if(options.method==='PUT')writes++;return{ok:true,status:200,json:async()=>({sha:'existing',content:Buffer.from(source).toString('base64')})};};
  await helpers.ensureWorkflow('token','owner','private','main',source);
  assert.equal(writes,0);
});
test('browser script parses and does not persist tokens or load third-party scripts', () => {
  const js=fs.readFileSync('builder.js','utf8'),html=fs.readFileSync('index.html','utf8');new vm.Script(js);
  assert(!/localStorage|sessionStorage|document\.cookie|console\.log/.test(js));
  for(const match of html.matchAll(/<script\b[^>]*src="([^"]+)"/g))assert(!match[1].startsWith('http'));
  assert(html.includes('type="password"'));assert(html.includes('type="file"'));
});
