'use client';

import { useEffect, useState } from 'react';

type Tenant = {
  id:number; code:string; name:string; business_type:string; tenant_status:string;
  plan_code:string; plan_status:string; starts_at:string|null; ends_at:string|null;
  user_limit:number; active_users:number;
};

const initial = {
  code:'defenzo', name:'Defenzo', legal_name:'Defenzo', business_type:'automotive_detailing',
  plan_code:'defenzo-free-year', plan_status:'draft', user_limit:10, starts_at:'', ends_at:'',
  branding:{ powered_by_axein:true },
};

export default function TenantAdminPage() {
  const [items,setItems]=useState<Tenant[]>([]);
  const [form,setForm]=useState(initial);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  async function load() {
    const res=await fetch('/api/platform/tenants',{cache:'no-store'});
    const data=await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(data.error || 'Unable to load tenants');
    setItems(Array.isArray(data.items) ? data.items : []);
  }
  useEffect(()=>{ load().catch((e)=>setMessage(e.message)); },[]);

  async function createTenant() {
    setBusy(true); setMessage('');
    try {
      const res=await fetch('/api/platform/tenants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
      const data=await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error || 'Unable to create tenant');
      setMessage(`Tenant created: ${data.business_id}. Apply the automotive template after the first admin is provisioned.`);
      await load();
    } catch(e:any) { setMessage(e.message); } finally { setBusy(false); }
  }

  async function createIntegration(businessId:number) {
    setBusy(true); setMessage('');
    try {
      const res=await fetch('/api/platform/integrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({business_id:businessId,provider:'defenzo'})});
      const data=await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error || 'Unable to create integration');
      setMessage(`Store now - Client: ${data.client_key} | Secret: ${data.secret} | AxEin env: ${data.environment_variable}`);
    } catch(e:any) { setMessage(e.message); } finally { setBusy(false); }
  }

  return <main className="container" style={{paddingTop:24,paddingBottom:40}}>
    <section className="card" style={{padding:20}}>
      <div className="muted" style={{fontSize:12,textTransform:'uppercase',letterSpacing:1.2}}>AxEin platform administration</div>
      <h1 style={{margin:'6px 0'}}>SaaS Tenants</h1>
      <p className="muted">Commercial entitlements remain controlled by AxEin. Customer administrators control only their users and permissions.</p>
    </section>
    <section className="card" style={{padding:20,marginTop:14}}>
      <h2>Create Defenzo Workspace</h2>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:10}}>
        {(['code','name','legal_name','plan_code'] as const).map((key)=><label key={key}><div className="muted">{key.replace(/_/g,' ')}</div><input className="input" value={(form as any)[key]} onChange={e=>setForm(s=>({...s,[key]:e.target.value}))}/></label>)}
        <label><div className="muted">Plan status</div><select className="input" value={form.plan_status} onChange={e=>setForm(s=>({...s,plan_status:e.target.value}))}><option value="draft">Draft / testing</option><option value="active">Active</option><option value="read_only">Read only</option><option value="suspended">Suspended</option></select></label>
        <label><div className="muted">User limit</div><input className="input" type="number" min={1} value={form.user_limit} onChange={e=>setForm(s=>({...s,user_limit:Number(e.target.value)||10}))}/></label>
        <label><div className="muted">Starts at</div><input className="input" type="datetime-local" value={form.starts_at} onChange={e=>setForm(s=>({...s,starts_at:e.target.value}))}/></label>
        <label><div className="muted">Ends at</div><input className="input" type="datetime-local" value={form.ends_at} onChange={e=>setForm(s=>({...s,ends_at:e.target.value}))}/></label>
      </div>
      <button className="btn btn-primary" style={{marginTop:12}} disabled={busy} onClick={createTenant}>{busy?'Working...':'Create Tenant'}</button>
      {message ? <div className="card" style={{padding:12,marginTop:12,overflowWrap:'anywhere'}}>{message}</div> : null}
    </section>
    <section className="card" style={{padding:20,marginTop:14}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h2>Current Tenants</h2><button className="btn" onClick={()=>load().catch(e=>setMessage(e.message))}>Refresh</button></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Business</th><th>Template</th><th>Plan</th><th>Users</th><th>Validity</th><th>Integration</th></tr></thead><tbody>
        {items.map(row=><tr key={row.id}><td><b>{row.name}</b><div className="muted">{row.code}</div></td><td>{row.business_type}</td><td>{row.plan_code}<div className="muted">{row.plan_status}</div></td><td>{row.active_users}/{row.user_limit}</td><td>{row.starts_at ? new Date(row.starts_at).toLocaleDateString() : 'Not started'} - {row.ends_at ? new Date(row.ends_at).toLocaleDateString() : 'Open'}</td><td><button className="btn" disabled={busy} onClick={()=>createIntegration(row.id)}>Create / Rotate</button></td></tr>)}
      </tbody></table></div>
    </section>
  </main>;
}
