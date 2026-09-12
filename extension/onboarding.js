const $=(id)=>document.getElementById(id);
const send=(payload)=>chrome.runtime.sendMessage({channel:'986code-control',...payload});
let lastHealth=null;
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function pill(el,text,state=''){el.textContent=text;el.className=(el.className.split(' ')[0]||'mini')+(state?` ${state}`:'');}
function installerCommand(id){return `986CodeBridge-Setup-v0.1.0-alpha.6.exe --extension-id ${id}`;}
function renderChecks(checks=[]){$('healthGrid').innerHTML=checks.map(c=>`<div class="health ${esc(c.status)}"><div class="top"><strong>${esc(c.label)}</strong><span class="dot"></span></div><small>${esc(c.detail)}</small></div>`).join('');}
async function refresh(){
  const info=await send({type:'info'});
  const health=await send({type:'health.get'}); lastHealth=health;
  $('extensionId').textContent=info.extensionId||chrome.runtime.id;
  $('instanceLabel').value=health.instanceLabel||info.instanceLabel||'';
  $('instance').textContent=health.instanceLabel||'—'; $('browser').textContent=health.browser||'CHROMIUM';
  $('installCommand').textContent=installerCommand(info.extensionId||chrome.runtime.id);
  $('writeTier').textContent=health.permissionTiers?.write?'ON':'OFF'; $('powerTier').textContent=health.permissionTiers?.power?'ON':'OFF';
  renderChecks(health.checks||[]);
  const errors=(health.checks||[]).filter(c=>c.status==='error').length, warns=(health.checks||[]).filter(c=>c.status==='warn').length;
  pill($('healthState'),errors?'ISSUE':warns?'PARTIAL':'READY',errors?'error':warns?'warn':'ready');
  pill($('overall'),errors?'ATTENTION':warns?'SETUP NEEDED':'READY',errors?'error':warns?'warn':'ready');
  pill($('identityState'),'READY','ready');
  const connected=health.nativeInfo?.ok===true; pill($('nativeState'),connected?'CONNECTED':health.nativePermission?'NOT CONNECTED':'OPTIONAL',connected?'ready':'warn');
  $('nativeHint').textContent=connected?`Native host ${health.nativeInfo.version} · ${health.latencyMs??'—'} ms`:health.nativePermission?(health.nativeStatus?.error||'Native Messaging enabled; native host not connected.'):'Enable Native Messaging only if you need MCP, SSH or local control-plane features.';
}$('saveIdentity').addEventListener('click',async()=>{const r=await send({type:'instance.update',instanceLabel:$('instanceLabel').value.trim()});if(!r?.ok)return alert(r?.error||'Could not save label.');await refresh();});
$('copyId').addEventListener('click',async()=>navigator.clipboard.writeText($('extensionId').textContent));
$('copyInstall').addEventListener('click',async()=>navigator.clipboard.writeText($('installCommand').textContent));
$('nativeBtn').addEventListener('click',async()=>{
  const enabled=await chrome.permissions.contains({permissions:['nativeMessaging']});
  const changed=enabled?await chrome.permissions.remove({permissions:['nativeMessaging']}):await chrome.permissions.request({permissions:['nativeMessaging']});
  if(!enabled&&changed) await send({type:'native.connect'}).catch(()=>null);
  await new Promise(r=>setTimeout(r,250)); await refresh();
});
$('connectBtn').addEventListener('click',async()=>{await send({type:'native.connect'}).catch(()=>null);await new Promise(r=>setTimeout(r,250));await refresh();});
$('refreshHealth').addEventListener('click',refresh);
$('openOptions').addEventListener('click',()=>chrome.runtime.openOptionsPage());
$('finishBtn').addEventListener('click',async()=>{
  const health=lastHealth||await send({type:'health.get'}); const errors=(health.checks||[]).filter(c=>c.status==='error');
  if(errors.length){$('finishNote').textContent=`Resolve ${errors.length} health issue(s) before finishing.`;return;}
  await send({type:'onboarding.complete'}); $('finishNote').textContent='Setup complete. You can close this tab.'; pill($('overall'),'COMPLETE','ready');
});
refresh().catch(error=>{pill($('overall'),'ERROR','error');$('nativeHint').textContent=String(error.message||error);});
