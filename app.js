'use strict';
const $ = selector => document.querySelector(selector);
const KEY = 'tuantuan-web-v1';
const widget = new URLSearchParams(location.search).get('widget') === '1';
if (widget) document.body.classList.add('widget');
const now = () => Date.now();
const fresh = () => ({created:now(),nickname:'',affection:12,fullness:70,energy:85,sleeping:false,sound:false,diary:[{id:crypto.randomUUID(),time:now(),type:'meet',text:'我们见面的第一天。',detail:'团团搬进了你的屏幕，新的陪伴开始了。'}],memories:[],chats:[],focus:null,focusMinutes:25,connectionDraft:{endpoint:'',model:''}});
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || typeof raw !== 'object') return fresh();
    const state = {...fresh(),...raw};
    for (const key of ['affection','fullness','energy']) state[key] = Math.min(100,Math.max(0,Number(state[key]) || 0));
    state.diary = Array.isArray(raw.diary) ? raw.diary.slice(0,100).filter(x=>x && typeof x.text==='string') : [];
    state.chats = Array.isArray(raw.chats) ? raw.chats.slice(-60).filter(x=>x && ['user','assistant'].includes(x.role) && typeof x.content==='string') : [];
    state.memories = Array.isArray(raw.memories) ? raw.memories.slice(0,30).filter(x=>x && typeof x.text==='string') : [];
    state.nickname = String(raw.nickname || '').slice(0,30);
    state.created = Number(raw.created) || now();
    state.focus = raw.focus && Number.isFinite(raw.focus.end) && Number.isFinite(raw.focus.minutes) ? raw.focus : null;
    state.focusMinutes = [5,15,25].includes(raw.focusMinutes) ? raw.focusMinutes : 25;
    state.connectionDraft = raw.connectionDraft && typeof raw.connectionDraft === 'object' ? raw.connectionDraft : {endpoint:'',model:''};
    return state;
  } catch { return fresh(); }
}
let state = loadState();
let connected = false, modelName = '', chatting = false, actionMood = '', actionTimeout, toastTimeout, gameCount = 0, audioContext;
const timeFormat = new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Shanghai'});
const dayFormat = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'2-digit',timeZone:'Asia/Shanghai'});
const fullFormat = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'});
function save() { try {localStorage.setItem(KEY,JSON.stringify(state));window.desktopPet?.changed();} catch {toast('本机存储不可用，本次记录可能无法保存。');} }
function synchronize() {state = loadState();render();}
window.addEventListener('storage',event=>{if(event.key===KEY)synchronize();});
window.desktopPet?.onSync(synchronize);
function toast(text) {clearTimeout(toastTimeout);$('#toast').textContent=text;$('#toast').hidden=false;toastTimeout=setTimeout(()=>$('#toast').hidden=true,3500);}
function journal(type,text,detail='') {state.diary.unshift({id:crypto.randomUUID(),time:now(),type,text,detail});state.diary=state.diary.slice(0,100);}
function icon(name) {const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href','#'+name);svg.append(use);svg.setAttribute('aria-hidden','true');return svg;}
function el(tag,className,text) {const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;}
const journalIcons = {meet:'paw',pat:'heart',feed:'food',play:'spark',sleep:'moon',focus:'leaf',memory:'book'};
function renderDiary() {
  const recent=$('#recent-moments');recent.replaceChildren();
  state.diary.slice(0,2).forEach(entry=>{
    const row=el('div','moment'),badge=el('div','moment-icon'),text=el('div');badge.append(icon(journalIcons[entry.type]||'paw'));text.append(el('p','',entry.text),el('small','',entry.detail || '一个值得留下的小片刻。'));row.append(badge,text,el('time','',timeFormat.format(entry.time)));recent.append(row);
  });
  const list=$('#diary-list');list.replaceChildren();
  state.diary.forEach(entry=>{
    const row=el('article','diary-entry'),badge=el('div','moment-icon'),text=el('div');badge.append(icon(journalIcons[entry.type]||'paw'));text.append(el('p','',entry.text),el('small','',`${fullFormat.format(entry.time)} ${timeFormat.format(entry.time)} · ${entry.detail||'一起度过的小片刻。'}`));row.append(badge,text);list.append(row);
  });
}
function renderMemories() {
  const list=$('#memory-list');list.replaceChildren();
  if(!state.memories.length)list.append(el('div','empty-state','这里还空着。收进一件你想让团团记住的小事吧。'));
  state.memories.forEach(memory=>{
    const row=el('article','memory-entry'),remove=el('button','', '忘掉这件事');
    remove.type='button';remove.setAttribute('aria-label',`删除记忆：${memory.text.slice(0,40)}`);
    remove.addEventListener('click',()=>{state.memories=state.memories.filter(x=>x.id!==memory.id);save();renderMemories();toast('这条记忆已经删除。');});
    row.append(el('p','',memory.text),remove);list.append(row);
  });
}
function addMessage(role,content,time=now(),extra='') {
  const row=el('div',`message ${role==='user'?'user':''} ${extra}`),p=el('p','',content),small=el('small','',role==='user'?`${state.nickname || '你'} · ${timeFormat.format(time)}`:`团团 · ${timeFormat.format(time)}`);row.append(p,small);$('#chat-messages').append(row);return row;
}
function renderChat() {
  if(chatting)return;
  const log=$('#chat-messages');log.replaceChildren(el('div','chat-date','我们的日常，从一句话开始'));
  if(!state.chats.length)addMessage('assistant','你来啦！我叫团团。\n可以摸摸我的脑袋，也可以把今天的小事告诉我。',state.created);
  state.chats.forEach(message=>addMessage(message.role,message.content,message.time));
  log.scrollTop=log.scrollHeight;
}
function renderMode() { $('#chat-status').textContent='网页版体验 · 本地预设回应'; $('#mode-note').textContent='当前聊天为预设回应体验。'; }
function renderMood() {
  const base = state.focus ? 'focusing' : state.sleeping ? 'sleeping' : '';
  $('.pet-card').className='pet-card'+(actionMood?' is-'+actionMood:base?' is-'+base:'');
  $('#mood-text').textContent=state.focus?'安静陪伴中':state.sleeping?'正在打盹':gameCount?'玩得开心':actionMood==='thinking'?'认真思考中':'心情晴朗';
  $('#sleep-button span').textContent=state.sleeping?'叫醒团团':'打个盹';
}
function renderTimer() {
  const remaining=state.focus?Math.max(0,Math.ceil((state.focus.end-now())/1000)):state.focusMinutes*60;
  $('#timer-text').textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
  $('#focus-button').textContent=state.focus?'结束这次专注  →':'开始一起专注  →';
  $('#focus-description').textContent=state.focus?'团团在安静陪着你，加油。':'你认真做事，我安静陪着。';
  $('#focus-duration').value=String(state.focusMinutes);$('#focus-duration').disabled=!!state.focus;
  $('.focus-card').classList.toggle('running',!!state.focus);
}
function render() {
  for(const key of ['affection','fullness','energy']) {$('#'+key+'-number').textContent=Math.round(state[key]);$('#'+key+'-bar').style.width=state[key]+'%';}
  $('#days-together').textContent=Math.max(1,Math.floor((now()-state.created)/86400000)+1);
  $('#today-date').textContent=dayFormat.format(now());$('#weekday').textContent=new Intl.DateTimeFormat('zh-CN',{weekday:'long',timeZone:'Asia/Shanghai'}).format(now());
  $('#greeting-sub').textContent=state.nickname?`${state.nickname}，团团已经准备好，陪你度过今天的小片刻。`:'团团已经准备好，陪你度过今天的小片刻。';
  $('#sound-button').classList.toggle('muted',!state.sound);$('#sound-button').setAttribute('aria-label',state.sound?'关闭互动音效':'开启互动音效');$('#sound-button').title=state.sound?'关闭互动音效':'开启互动音效';
  renderMood();renderDiary();renderMemories();renderChat();renderTimer();renderMode();
}
function bubble(text) {$('#pet-bubble').textContent=text;}
function reaction(mood,text,duration=2800) {clearTimeout(actionTimeout);actionMood=mood;bubble(text);renderMood();actionTimeout=setTimeout(()=>{actionMood='';renderMood();bubble(state.focus?'我安静陪着你。':state.sleeping?'呼…再睡一小会儿。':'这里暖暖的，刚好可以待着。');},duration);}
function particles(symbol='♡') {for(let i=0;i<5;i++){const particle=el('span','particle',symbol);particle.style.setProperty('--dx',`${(i-2)*28}px`);particle.style.animationDelay=`${i*70}ms`;$('#particles').append(particle);setTimeout(()=>particle.remove(),1800);}}
function chirp(kind='happy') {
  if(!state.sound)return;
  try {
    audioContext ||= new AudioContext();audioContext.resume();
    const sequence=kind==='feed'?[440,554,659]:kind==='sleep'?[440,330]:[659,880,784];
    sequence.forEach((frequency,i)=>{const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),start=audioContext.currentTime+i*.09;oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.035,start+.015);gain.gain.exponentialRampToValueAtTime(.001,start+.13);oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(start);oscillator.stop(start+.14);});
  } catch {toast('当前环境无法播放音效。');}
}
let lastPat=0,lastFeed=0;
function pat() {
  if(now()-lastPat<800)return;lastPat=now();
  if(state.focus){reaction('happy','轻轻的摸摸，我收到了。你继续，我陪着。');particles();return;}
  if(state.sleeping){reaction('sleeping','嗯…我梦见你给我带饼干了。');return;}
  state.affection=Math.min(100,state.affection+2);journal('pat','收到一个温柔的摸摸。','今天又熟悉你一点点。');save();render();reaction('happy',['嘿嘿，再摸一下也可以。','脑袋暖暖的，心里也是。','这个摸摸，我收好啦。'][Math.floor(Math.random()*3)]);particles();chirp();
}
function feed() {
  if(now()-lastFeed<1800)return;lastFeed=now();
  if(state.sleeping){bubble('我还在睡觉，等醒来再吃吧。');return;}
  if(state.fullness>=100){reaction('happy','肚子已经圆圆的啦，留一点下次吃。');return;}
  state.fullness=Math.min(100,state.fullness+12);state.energy=Math.min(100,state.energy+3);state.affection=Math.min(100,state.affection+1);journal('feed','分享了一块小饼干。','咔嚓咔嚓，今天的小幸福。');save();render();reaction('eating','咔嚓…是我喜欢的小饼干！');particles('✦');chirp('feed');
}
function moveFirefly() {$('#firefly').style.left=`${15+Math.random()*65}%`;$('#firefly').style.top=`${30+Math.random()*36}%`;}
function play() {
  if(state.focus){toast('专注结束后再玩吧，团团会等你。');return;}
  if(state.sleeping){toast('先叫醒团团，再一起玩吧。');return;}
  if(gameCount){gameCount=0;$('#firefly').hidden=true;$('#play-button').replaceChildren(icon('spark'),document.createTextNode('玩一会儿'));reaction('','我们下次再抓萤火虫。');return;}
  gameCount=1;$('#firefly').hidden=false;moveFirefly();$('#play-button').replaceChildren(icon('close'),document.createTextNode('结束游戏'));reaction('playing','帮我抓到 3 只萤火虫吧！',60000);renderMood();
}
$('#firefly').addEventListener('click',()=>{
  if(!gameCount)return;chirp();particles('✦');
  const caught=gameCount;gameCount++;
  if(caught===3){gameCount=0;$('#firefly').hidden=true;$('#play-button').replaceChildren(icon('spark'),document.createTextNode('玩一会儿'));state.affection=Math.min(100,state.affection+4);state.energy=Math.max(0,state.energy-5);state.fullness=Math.max(0,state.fullness-4);journal('play','一起抓到了 3 只萤火虫。','你出手，我负责开心。');save();render();reaction('happy','三只都抓到啦！你也太厉害了。');}
  else{bubble(`抓到 ${caught} 只啦，还差 ${3-caught} 只！`);moveFirefly();}
});
function sleep() {
  if(state.focus){toast('正在专注陪伴中，结束后可以让团团打盹。');return;}
  if(gameCount)play();
  state.sleeping=!state.sleeping;
  if(!state.sleeping)state.energy=Math.min(100,state.energy+10);
  journal('sleep',state.sleeping?'团团打起了小盹。':'团团伸了个懒腰。',state.sleeping?'休息，也是日常的一部分。':'又有精神陪你啦。');save();render();reaction(state.sleeping?'sleeping':'happy',state.sleeping?'呼…我就眯一小会儿。':'睡醒啦！还好你在。');chirp('sleep');
}
function view(name) {for(const node of document.querySelectorAll('.view'))node.hidden=node.id!==name+'-view';for(const button of document.querySelectorAll('[data-view]'))button.classList.toggle('active',button.dataset.view===name);$('#page-name').textContent={home:'我的团团',diary:'陪伴日记',memory:'小小记忆'}[name];location.hash=name;}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>view(button.dataset.view)));
$('.brand').addEventListener('click',()=>view('home'));$('#all-diary').addEventListener('click',()=>view('diary'));
$('#pet-touch').addEventListener('click',pat);$('#pat-button').addEventListener('click',pat);$('#feed-button').addEventListener('click',feed);$('#play-button').addEventListener('click',play);$('#sleep-button').addEventListener('click',sleep);
$('#sound-button').addEventListener('click',()=>{state.sound=!state.sound;save();render();chirp();toast(state.sound?'互动音效已开启。':'互动音效已关闭。');});
$('#memory-form').addEventListener('submit',event=>{
  event.preventDefault();const text=$('#memory-input').value.trim();if(!text)return;
  if(state.memories.length>=30){toast('最多保存 30 条记忆，先整理一下吧。');return;}
  if(state.memories.some(x=>x.text===text)){toast('这件事已经记住了。');return;}
  state.memories.unshift({id:crypto.randomUUID(),text,time:now()});journal('memory','收好了一件关于你的小事。','只记住你愿意告诉我的。');save();renderMemories();renderDiary();$('#memory-input').value='';toast('已收进团团的小小记忆。');
});
function openSettings() {$('#nickname-input').value=state.nickname;$('#settings-dialog').showModal();}
$('#settings-button').addEventListener('click',openSettings);$('#close-settings').addEventListener('click',()=>$('#settings-dialog').close());
$('#settings-dialog').addEventListener('click',event=>{if(event.target===$('#settings-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
$('#save-nickname').addEventListener('click',()=>{state.nickname=$('#nickname-input').value.trim();save();render();toast('称呼已保存。');});
function demoReply(text) {
  if(/学习|专注|工作|作品集/.test(text))return '好呀！你可以点「开始一起专注」，我就安静趴在这里。\n这一小段时间，我们一起过。';
  if(/累|难过|压力|烦|焦虑/.test(text))return '那先在我旁边坐一会儿吧，不急着做下一件事。\n喝点水，松松肩膀。我在这里陪着。';
  if(/故事/.test(text))return '有一只小团子，每天都在窗边收集阳光。\n有天朋友问它收集来做什么，它说：「等你来的时候，给你一个暖暖的位置。」';
  if(/你好|嗨|hello|hi/i.test(text))return `嗨，${state.nickname||'朋友'}！我刚刚在数窗边的阳光。你一来，今天就更好了。`;
  if(/记住|喜欢|叫我/.test(text))return '想让我记住这件事，可以把它收进「小小记忆」。\n它会保存在这个浏览器里。';
  if(/谢谢|可爱|喜欢你/.test(text))return '嘿嘿，耳朵都开心得翘起来了。\n这个夸夸，我想收好一整天。';
  return '我听到你啦，先陪你安静待一会儿。\n现在是预设回应的体验模式，可以试试上方的三种话题。';
}
async function chat(text) {
  text=text.trim();if(!text||chatting)return;if(text.length>2000){toast('消息最多 2000 字。');return;}
  chatting=true;$('#send-button').disabled=true;document.querySelectorAll('[data-prompt]').forEach(x=>x.disabled=true);
  const requestMessages=[...state.chats.slice(-19),{role:'user',content:text}];
  state.chats.push({role:'user',content:text,time:now()});save();addMessage('user',text);$('#chat-input').value='';
  const pending=addMessage('assistant',connected?'团团在认真想…':'团团凑近了一点…',now(),'pending');$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;reaction('thinking','让我想一想…',35000);
  try {
    let answer;
    await new Promise(resolve=>setTimeout(resolve,700));answer=demoReply(text);
    pending.remove();state.chats.push({role:'assistant',content:answer,time:now()});state.chats=state.chats.slice(-60);save();addMessage('assistant',answer);reaction('happy','你说的，我都有在认真听。');
  } catch(error) {
    pending.remove();const message=error.name==='TimeoutError'?'模型响应超时，稍后再试一次吧。':error.message;addMessage('assistant',message,now(),'error');reaction('','连接没有成功，我们稍后再试吧。');
  } finally {chatting=false;$('#send-button').disabled=false;document.querySelectorAll('[data-prompt]').forEach(x=>x.disabled=false);$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;$('#chat-input').focus();}
}
$('#chat-form').addEventListener('submit',event=>{event.preventDefault();chat($('#chat-input').value);});
$('#chat-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();chat(event.target.value);}});
document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>chat(button.dataset.prompt)));
$('#focus-duration').addEventListener('change',event=>{state.focusMinutes=Number(event.target.value);save();renderTimer();});
function finishFocus(completed) {
  const focus=state.focus;if(!focus)return;state.focus=null;
  if(completed){state.affection=Math.min(100,state.affection+3);journal('focus',`一起完成了 ${focus.minutes} 分钟专注。`,'你在认真做事，团团在安静陪伴。');}
  else{const elapsed=Math.max(0,Math.floor((now()-(focus.end-focus.minutes*60000))/60000));journal('focus',`结束了一次专注，陪伴了 ${elapsed} 分钟。`,'调整节奏，再慢慢开始。');}
  save();render();reaction('happy',completed?'时间到啦！伸个懒腰，你已经很棒了。':'辛苦啦，我们歇一会儿。');chirp();
}
$('#focus-button').addEventListener('click',()=>{if(state.focus){finishFocus(false);return;}if(gameCount)play();state.sleeping=false;state.focus={end:now()+state.focusMinutes*60000,minutes:state.focusMinutes};save();actionMood='';clearTimeout(actionTimeout);render();bubble('你认真做事，我安静陪着。');});
setInterval(()=>{if(state.focus&&state.focus.end<=now()){state=loadState();if(state.focus&&state.focus.end<=now())finishFocus(true);}else renderTimer();},500);
$('#desktop-button').addEventListener('click',()=>{if(window.desktopPet)window.desktopPet.show();else{const popup=window.open('/?widget=1','tuantuan-widget','width=300,height=360');if(!popup)toast('请允许打开小窗口，或使用桌面启动器。');else toast('小窗已打开。透明、置顶桌宠请使用 Windows 版本。');}});
$('#widget-home').addEventListener('click',()=>{if(window.desktopPet)window.desktopPet.home();else window.open('/','tuantuan-home');});
$('#widget-close').addEventListener('click',()=>{if(window.desktopPet)window.desktopPet.close();else window.close();});
render();save();
if(!widget){const hash=location.hash.slice(1);if(['diary','memory','home'].includes(hash))view(hash);}
