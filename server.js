const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const querystring = require('querystring');

const PORT = process.env.PORT || 5000;
const DB_FILE = path.join(__dirname, 'data.json');

const sessions = new Map();

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      users: [],
      loginTokens: [],
      surveys: [],
      questions: [],
      invitations: [],
      responses: [],
      answers: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function id() { return crypto.randomUUID(); }

function layout(title, body, user, flash='') {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:Arial;background:linear-gradient(135deg,#0f172a,#312e81);color:#e2e8f0;margin:0}.top{padding:12px 24px;background:#020617b3;display:flex;justify-content:space-between}.c{max-width:1000px;margin:24px auto;padding:0 16px}.card{background:#111827;border:1px solid #374151;border-radius:12px;padding:16px;margin-bottom:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}input,select,textarea,button{width:100%;padding:8px;border-radius:8px;border:1px solid #374151;background:#0b1220;color:#fff}button,a.btn{background:#06b6d4;border:none;padding:9px 12px;border-radius:8px;color:#001;text-decoration:none;display:inline-block;margin-top:8px}.flash{background:#164e63;padding:8px;border-radius:8px;margin-bottom:10px}</style></head>
  <body><div class="top"><b>🎯 PulseSurvey</b><div>${user?`${user.name} (${user.isAdmin?'Admin':'Employee'}) <a href='/dashboard'>Dashboard</a> <a href='/logout'>Logout</a>`:''}</div></div>
  <div class='c'>${flash?`<div class='flash'>${flash}</div>`:''}${body}</div></body></html>`;
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v=>v.trim().split('=')));
}
function getUser(req, db){
  const sid = parseCookies(req).sid;
  if (!sid || !sessions.has(sid)) return null;
  const email = sessions.get(sid);
  return db.users.find(u => u.email===email) || null;
}
function send(res, html, status=200, headers={}){ res.writeHead(status, {'Content-Type':'text/html; charset=utf-8', ...headers}); res.end(html); }
function redirect(res, location, headers={}){ res.writeHead(302, {Location: location, ...headers}); res.end(); }
function readBody(req){ return new Promise(resolve=>{ let d=''; req.on('data',c=>d+=c); req.on('end',()=>resolve(querystring.parse(d))); }); }
function requireLogin(req,res,db){ const u=getUser(req,db); if(!u){redirect(res,'/'); return null;} return u; }
function requireAdmin(req,res,db){ const u=requireLogin(req,res,db); if(!u) return null; if(!u.isAdmin){send(res,layout('Denied','<div class=card>Admin only.</div>',u),403);return null;} return u; }

function surveyAnalytics(db, surveyId){
  const qs = db.questions.filter(q=>q.surveyId===surveyId).sort((a,b)=>a.position-b.position);
  const rs = db.responses.filter(r=>r.surveyId===surveyId);
  const summaries = qs.map(q=>{
    const vals = db.answers.filter(a=>a.questionId===q.id && rs.some(r=>r.id===a.responseId)).map(a=>a.value);
    if(['rating','dropdown','multiple_choice'].includes(q.type)){
      const c={}; vals.forEach(v=>c[v]=(c[v]||0)+1); return {q, summary:c};
    }
    return {q, summary:vals};
  });
  return {count:rs.length, summaries};
}

function exportRows(db, surveyId){
  const qs = db.questions.filter(q=>q.surveyId===surveyId).sort((a,b)=>a.position-b.position);
  return db.responses.filter(r=>r.surveyId===surveyId).map(r=>{
    const row={Name:r.name, Email:r.email, SubmittedAt:r.submittedAt};
    qs.forEach(q=>{
      const a = db.answers.find(x=>x.responseId===r.id && x.questionId===q.id);
      row[q.prompt]=a?a.value:'';
    });
    return row;
  });
}

const server = http.createServer(async (req,res)=>{
  const db = loadDB();
  const url = new URL(req.url, `http://${req.headers.host}`);
  const user = getUser(req, db);

  if (url.pathname === '/' && req.method === 'GET') {
    const body = `<div class='card'><h2>Internal Employee Survey Platform</h2>
    <form method='post' action='/login'><label>Email<input type='email' name='email' required></label><label>Name<input name='name'></label><button>Send Passwordless Link</button></form>
    <p>Use <code>leader@admin.local</code> for admin demo.</p></div>`;
    return send(res, layout('Login', body, user));
  }

  if (url.pathname === '/login' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || email.split('@')[0] || 'User').trim();
    if (!db.users.some(u=>u.email===email)) db.users.push({email,name,isAdmin:email.endsWith('@admin.local')});
    const token = crypto.randomBytes(16).toString('hex');
    db.loginTokens.push({token,email,expiresAt:Date.now()+10*60*1000,used:false});
    saveDB(db);
    return send(res, layout('Magic Link', `<div class='card'>Magic link (demo): <a href='/verify/${token}'>/verify/${token}</a></div>`, user));
  }

  if (url.pathname.startsWith('/verify/')) {
    const token = url.pathname.split('/').pop();
    const row = db.loginTokens.find(t=>t.token===token && !t.used && t.expiresAt>Date.now());
    if(!row) return send(res, layout('Login','<div class=card>Invalid/expired token.</div>', user),400);
    row.used = true; saveDB(db);
    const sid = id(); sessions.set(sid,row.email);
    return redirect(res,'/dashboard',{'Set-Cookie':`sid=${sid}; Path=/; HttpOnly`});
  }

  if (url.pathname === '/logout') {
    const sid = parseCookies(req).sid; if(sid) sessions.delete(sid);
    return redirect(res,'/',{'Set-Cookie':'sid=; Path=/; Max-Age=0'});
  }

  if (url.pathname === '/dashboard') {
    const u = requireLogin(req,res,db); if(!u) return;
    if (u.isAdmin) {
      const cards = db.surveys.map(s=>`<div class='card'><h3>${s.title}</h3><p>${s.description||''}</p><p>${s.published?'Published':'Draft'}</p>
      <a class='btn' href='/survey/${s.id}'>Manage</a> <a class='btn' href='/report/${s.id}'>Analytics</a>
      ${!s.published?`<form method='post' action='/publish/${s.id}'><button>Publish</button></form>`:''}</div>`).join('');
      return send(res, layout('Admin', `<a class='btn' href='/survey/new'>+ Create Survey</a><div class='grid'>${cards||'<p>No surveys</p>'}</div>`, u));
    }
    const invites = db.invitations.filter(i=>i.email===u.email).map(i=>{
      const s = db.surveys.find(x=>x.id===i.surveyId);
      return `<div class='card'><h3>${s?.title||'Unknown'}</h3><p>Status: ${i.status}</p><a class='btn' href='/survey/${i.surveyId}'>Open</a><a class='btn' href='/my-report/${i.surveyId}'>My report</a></div>`;
    }).join('');
    return send(res, layout('Employee', `<div class='grid'>${invites||'No assigned surveys.'}</div>`, u));
  }

  if (url.pathname === '/survey/new' && req.method === 'GET') {
    const u = requireAdmin(req,res,db); if(!u) return;
    return send(res, layout('New Survey', `<div class='card'><form method='post' action='/survey/new'>
    <label>Title<input name='title' required></label><label>Description<textarea name='description'></textarea></label>
    <label><input type='checkbox' name='individualReport'> Enable individual report</label>
    <p>Questions JSON (array): [{"prompt":"How do you rate work-life balance?","type":"rating","options":[]}]</p>
    <textarea name='questions' rows='8' required></textarea><button>Create</button></form></div>`, u));
  }
  if (url.pathname === '/survey/new' && req.method === 'POST') {
    const u = requireAdmin(req,res,db); if(!u) return;
    const b = await readBody(req);
    let qs=[]; try{ qs=JSON.parse(String(b.questions||'[]')); }catch{ qs=[]; }
    const survey = {id:id(),title:String(b.title),description:String(b.description||''),published:false,individualReport:Boolean(b.individualReport),createdBy:u.email,createdAt:Date.now()};
    db.surveys.push(survey);
    qs.forEach((q,i)=>db.questions.push({id:id(),surveyId:survey.id,prompt:q.prompt,type:q.type,options:q.options||[],position:i+1}));
    saveDB(db); return redirect(res,'/dashboard');
  }

  if (url.pathname.startsWith('/publish/') && req.method === 'POST') {
    const u = requireAdmin(req,res,db); if(!u) return;
    const sid=url.pathname.split('/').pop(); const s=db.surveys.find(x=>x.id===sid); if(s) s.published=true; saveDB(db); return redirect(res,'/dashboard');
  }

  if (url.pathname.startsWith('/survey/')) {
    const sid = url.pathname.split('/')[2];
    const survey = db.surveys.find(s=>s.id===sid); if(!survey) return send(res,'Not found',404);
    const qs = db.questions.filter(q=>q.surveyId===sid).sort((a,b)=>a.position-b.position);
    const u = requireLogin(req,res,db); if(!u) return;

    if (req.method==='GET') {
      if (u.isAdmin) {
        const invites = db.invitations.filter(i=>i.surveyId===sid);
        const completed = invites.filter(i=>i.status==='completed').length;
        const analytics = surveyAnalytics(db,sid);
        return send(res, layout('Manage Survey', `<div class='card'><h2>${survey.title}</h2><p>Invited: ${invites.length} | Completed: ${completed} | Pending: ${invites.length-completed}</p>
        <form method='post' action='/invite/${sid}'><textarea name='recipients' rows='7' placeholder='email,name'></textarea><button>Distribute via Email IDs</button></form>
        <h3>Question-wise analysis</h3>${analytics.summaries.map(x=>`<p><b>${x.q.prompt}</b>: ${JSON.stringify(x.summary)}</p>`).join('')}</div>`, u));
      }
      const done = db.responses.some(r=>r.surveyId===sid && r.email===u.email);
      const invitation = db.invitations.find(i=>i.surveyId===sid && i.email===u.email);
      if(!invitation) return send(res, layout('No Access','<div class=card>You are not invited to this survey.</div>',u),403);
      const fields = qs.map(q=>{
        if(q.type==='rating') return `<label>${q.prompt}<select name='${q.id}' required><option></option>${[1,2,3,4,5].map(n=>`<option>${n}</option>`).join('')}</select></label>`;
        if(q.type==='dropdown'||q.type==='multiple_choice') return `<label>${q.prompt}<select name='${q.id}' required><option></option>${q.options.map(o=>`<option>${o}</option>`).join('')}</select></label>`;
        return `<label>${q.prompt}<textarea name='${q.id}' required></textarea></label>`;
      }).join('');
      return send(res, layout('Survey', `<div class='card'><h2>${survey.title}</h2><p>${survey.description||''}</p>${done?'<p>Already submitted. One response per email enforced.</p>':`<form method='post'>${fields}<button>Submit +50 points</button></form>`}</div>`, u));
    }

    if (req.method==='POST') {
      if(u.isAdmin) return redirect(res,`/survey/${sid}`);
      if (db.responses.some(r=>r.surveyId===sid && r.email===u.email)) return send(res, layout('Duplicate','<div class=card>Duplicate submission blocked.</div>',u),400);
      const b = await readBody(req);
      const resp = {id:id(),surveyId:sid,email:u.email,name:u.name,submittedAt:new Date().toISOString()};
      db.responses.push(resp);
      qs.forEach(q=>db.answers.push({id:id(),responseId:resp.id,questionId:q.id,value:String(b[q.id]||'')}));
      const inv = db.invitations.find(i=>i.surveyId===sid && i.email===u.email); if(inv){inv.status='completed'; inv.respondedAt=Date.now();}
      saveDB(db); return redirect(res,'/dashboard');
    }
  }

  if (url.pathname.startsWith('/invite/') && req.method==='POST') {
    const u=requireAdmin(req,res,db); if(!u) return;
    const sid=url.pathname.split('/').pop(); const b=await readBody(req);
    String(b.recipients||'').split('\n').map(v=>v.trim()).filter(Boolean).forEach(line=>{
      const [email,nameRaw] = line.split(','); const e=email.trim().toLowerCase(); const n=(nameRaw||e.split('@')[0]).trim();
      if(!db.users.some(x=>x.email===e)) db.users.push({email:e,name:n,isAdmin:false});
      if(!db.invitations.some(i=>i.surveyId===sid && i.email===e)) db.invitations.push({id:id(),surveyId:sid,email:e,name:n,status:'pending',invitedAt:Date.now()});
    });
    saveDB(db); return redirect(res,`/survey/${sid}`);
  }

  if (url.pathname.startsWith('/report/')) {
    const u=requireAdmin(req,res,db); if(!u) return;
    const sid=url.pathname.split('/').pop(); const survey=db.surveys.find(s=>s.id===sid);
    const invites=db.invitations.filter(i=>i.surveyId===sid); const completed=invites.filter(i=>i.status==='completed').length;
    const analytics=surveyAnalytics(db,sid);
    return send(res, layout('Report', `<div class='card'><h2>${survey.title} Analytics</h2><p>Participation: ${completed}/${invites.length} (${invites.length?Math.round((completed/invites.length)*100):0}%)</p>
    <a class='btn' href='/export/${sid}/xlsx'>Excel</a> <a class='btn' href='/export/${sid}/pdf'>PDF</a> <a class='btn' href='/export/${sid}/ppt'>PowerPoint</a>
    ${analytics.summaries.map(x=>`<p><b>${x.q.prompt}</b>: ${JSON.stringify(x.summary)}</p>`).join('')}</div>`,u));
  }

  if (url.pathname.startsWith('/my-report/')) {
    const u=requireLogin(req,res,db); if(!u) return;
    const sid=url.pathname.split('/').pop(); const survey=db.surveys.find(s=>s.id===sid);
    if(!survey?.individualReport) return send(res,layout('Disabled','<div class=card>Individual report not enabled.</div>',u),403);
    const r=db.responses.find(x=>x.surveyId===sid&&x.email===u.email); if(!r) return send(res,layout('Missing','<div class=card>No response yet.</div>',u),404);
    const lines=db.answers.filter(a=>a.responseId===r.id).map(a=>`<li><b>${db.questions.find(q=>q.id===a.questionId)?.prompt}</b>: ${a.value}</li>`).join('');
    return send(res,layout('My report',`<div class='card'><ul>${lines}</ul></div>`,u));
  }

  if (url.pathname.startsWith('/export/')) {
    const u=requireAdmin(req,res,db); if(!u) return;
    const [, , sid, fmt] = url.pathname.split('/');
    const rows=exportRows(db,sid);
    const headers = rows[0] ? Object.keys(rows[0]) : ['Name','Email','SubmittedAt'];
    const tsv = [headers.join('\t'), ...rows.map(r=>headers.map(h=>String(r[h]||'')).join('\t'))].join('\n');
    if(fmt==='xlsx') return res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename=survey-${sid}.xlsx`})||res.end(tsv);
    if(fmt==='pdf') return res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename=survey-${sid}.pdf`})||res.end(`PulseSurvey PDF Report\n\n${tsv}`);
    if(fmt==='ppt') return res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.presentationml.presentation','Content-Disposition':`attachment; filename=survey-${sid}.pptx`})||res.end(`PulseSurvey PowerPoint Report\n\n${tsv}`);
  }

  send(res, layout('Not found', '<div class=card>404</div>', user), 404);
});

server.listen(PORT, '0.0.0.0', ()=>console.log(`PulseSurvey running on ${PORT}`));
