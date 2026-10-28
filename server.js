// Sirkle server. Node 18+, no npm install needed. Run: node server.js
const http=require("http"),fs=require("fs"),c=require("crypto"),PORT=process.env.PORT||3000;
const SEC=process.env.SECRET||(()=>{try{return fs.readFileSync(".secret","utf8")}catch(e){const s=c.randomBytes(32).toString("hex");fs.writeFileSync(".secret",s);return s}})();
let D={users:[],rides:[]};try{D=JSON.parse(fs.readFileSync("data.json"))}catch(e){}
const save=()=>fs.writeFileSync("data.json",JSON.stringify(D));
const H=(p,s)=>{s=s||c.randomBytes(16).toString("hex");return s+":"+c.scryptSync(p,s,64).toString("hex")};
const same=(a,b)=>a.length==b.length&&c.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const mac=b=>c.createHmac("sha256",SEC).update(b).digest("base64url");
const sign=u=>{const b=Buffer.from(JSON.stringify({id:u.id,exp:Date.now()+6048e5})).toString("base64url");return b+"."+mac(b)};
const who=t=>{const[b,s]=(t||"").split(".");if(!s||!same(mac(b),s))return;try{const o=JSON.parse(Buffer.from(b,"base64url"));return o.exp>Date.now()?D.users.find(u=>u.id==o.id):0}catch(e){}};
const pub=u=>({id:u.id,name:u.name,email:u.email,role:u.role,vehicle:u.vehicle,plate:u.plate});
// ---- PRICING (edit here) ----
// Market reference = what other passenger apps typically charge: R7 per km (minimum R25), higher for Comfort and XL.
// Sirkle's fare = market price minus a discount of R3 to R5 on the overall trip (bigger trips get closer to R5).
// Sirkle takes only 10% from drivers, so drivers keep more than they would elsewhere.
const PR={commission:0.10,market:{perKm:7,min:25,tier:[1,1.2,1.5]},discount:{min:3,max:5,fullAtKm:20}},
mkt=(o,km)=>Math.round(Math.max(PR.market.min,PR.market.perKm*km)*PR.market.tier[o]),
disc=km=>Math.min(PR.discount.max,Math.max(PR.discount.min,PR.discount.min+(PR.discount.max-PR.discount.min)*km/PR.discount.fullAtKm)),
price=(o,km)=>Math.round(mkt(o,km)-disc(km)),
OPEN=["searching","accepted","arrived","ontrip"],tries={},num=x=>typeof x=="number"&&isFinite(x);
const place=a=>Array.isArray(a)&&typeof a[0]=="string"&&num(a[1])&&num(a[2])&&Math.abs(a[1])<=90&&Math.abs(a[2])<=180?[a[0].slice(0,80),a[1],a[2]]:null;
const web={"/":"index.html","/driver":"driver.html","/demo":"demo.html"};
const body=q=>new Promise(res=>{let d="";q.on("data",x=>{d+=x;if(d.length>2e6)q.destroy()});q.on("end",()=>{try{res(JSON.parse(d||"{}"))}catch(e){res({})}})});
const out=(r,code,o)=>{r.writeHead(code,{"Content-Type":"application/json"});r.end(JSON.stringify(o))},E=(r,code,m)=>out(r,code,{error:m});
http.createServer(async(q,r)=>{try{
const url=new URL(q.url,"http://x"),p=url.pathname,m=q.method,now=Date.now();
if(!p.startsWith("/api/")){const f=web[p];if(!f){r.writeHead(404);return r.end("Not found")}r.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});return r.end(fs.readFileSync(f))}
const B=m=="POST"?await body(q):{};
D.rides.forEach(x=>{if(x.status=="searching"&&now-x.created>6e5)x.status="cancelled"});
if(p=="/api/register"&&m=="POST"){
 const n=String(B.name||"").trim(),e=String(B.email||"").trim().toLowerCase(),pw=String(B.password||""),role=B.role=="driver"?"driver":"rider";
 const v=String(B.vehicle||"").trim().slice(0,40),pl=String(B.plate||"").trim().toUpperCase().slice(0,15);
 if(n.length<2||n.length>60)return E(r,400,"Enter your full name");
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))return E(r,400,"Enter a valid email");
 if(pw.length<8)return E(r,400,"Password must be at least 8 characters");
 if(role=="driver"&&(v.length<2||pl.length<2))return E(r,400,"Enter your vehicle and number plate");
 if(D.users.some(x=>x.email==e))return E(r,409,"That email is already registered");
 const x={id:c.randomUUID(),name:n,email:e,role,pw:H(pw),vehicle:v,plate:pl,online:false};D.users.push(x);save();return out(r,200,{token:sign(x),user:pub(x)})}
if(p=="/api/login"&&m=="POST"){const k=q.socket.remoteAddress,t=tries[k]=(tries[k]||[]).filter(z=>now-z<9e5);
 if(t.length>=10)return E(r,429,"Too many attempts. Try again in 15 minutes");
 const x=D.users.find(z=>z.email==String(B.email||"").trim().toLowerCase());
 if(!x||!same(H(String(B.password||""),x.pw.split(":")[0]),x.pw)){t.push(now);return E(r,401,"Wrong email or password")}
 return out(r,200,{token:sign(x),user:pub(x)})}
const U=who((q.headers.authorization||"").slice(7));if(!U)return E(r,401,"Please log in");
if(p=="/api/me")return out(r,200,{user:pub(U)});
if(p=="/api/quote"){const km=+url.searchParams.get("km"),mi=+url.searchParams.get("mins");if(!(km>0&&km<=500))return E(r,400,"Invalid distance");
 return out(r,200,{fares:PR.market.tier.map((t,i)=>price(i,km)),market:PR.market.tier.map((t,i)=>mkt(i,km))})}
const R=D.rides.find(x=>p.startsWith("/api/rides/"+x.id+"/"));
if(p=="/api/rides"&&m=="POST"){if(U.role!="rider")return E(r,403,"Riders only");
 if(D.rides.some(x=>x.rider==U.id&&OPEN.includes(x.status)))return E(r,409,"You already have an active ride");
 const a=place(B.pick),b=place(B.drop),o=Number.isInteger(B.opt)&&PR.market.tier[B.opt],km=B.km;
 if(!a||!b||!o||!num(km)||km<=0||km>500)return E(r,400,"Invalid ride request");
 const route=Array.isArray(B.route)&&B.route.length<3000&&B.route.every(z=>Array.isArray(z)&&num(z[0])&&num(z[1]))?B.route:null;
 const mins=num(B.mins)&&B.mins>=1&&B.mins<=600?B.mins:Math.round(km*2.4+4),fare=price(B.opt,km,mins),cm=Math.round(fare*PR.commission*100)/100;
 const x={id:c.randomUUID(),rider:U.id,riderName:U.name,pick:a,drop:b,opt:B.opt,pay:B.pay=="Cash"?"Cash":"Card",km,mins,fare,commission:cm,driverPay:Math.round((fare-cm)*100)/100,route,status:"searching",created:now};
 D.rides.push(x);save();return out(r,200,{ride:x})}
if(p=="/api/rides/active"){const rs=D.rides.filter(x=>x.rider==U.id&&(OPEN.includes(x.status)||x.status=="completed"&&!x.rated));return out(r,200,{ride:rs[rs.length-1]||null})}
if(R&&p.endsWith("/cancel")&&R.rider==U.id&&["searching","accepted","arrived"].includes(R.status)){R.status="cancelled";save();return out(r,200,{ride:R})}
if(R&&p.endsWith("/rate")&&R.rider==U.id&&R.status=="completed"){R.rated=Math.min(5,Math.max(1,+B.rate||5));save();return out(r,200,{ok:1})}
if(U.role=="driver"){
 const mine=D.rides.find(x=>x.driverId==U.id&&["accepted","arrived","ontrip"].includes(x.status));
 if(p=="/api/driver/state"){const day=new Date().setHours(0,0,0,0);
  return out(r,200,{online:U.online,ride:mine||null,requests:U.online&&!mine?D.rides.filter(x=>x.status=="searching").slice(-10).map(x=>({id:x.id,riderName:x.riderName,pick:x.pick,drop:x.drop,km:x.km,fare:x.fare,driverPay:x.driverPay,pay:x.pay})):[],earnings:D.rides.filter(x=>x.driverId==U.id&&x.status=="completed"&&x.done>=day).reduce((s,x)=>s+(x.driverPay||x.fare),0)})}
 if(p=="/api/driver/online"&&m=="POST"){U.online=!!B.online;save();return out(r,200,{online:U.online})}
 if(p=="/api/driver/loc"&&m=="POST"&&num(B.lat)&&num(B.lon)){if(mine)mine.loc=[B.lat,B.lon];return out(r,200,{ok:1})}
 if(R&&p.endsWith("/accept")&&m=="POST"){if(!U.online||mine||R.status!="searching")return E(r,409,"Ride no longer available");
  Object.assign(R,{status:"accepted",driverId:U.id,driver:{name:U.name,vehicle:U.vehicle,plate:U.plate}});save();return out(r,200,{ride:R})}
 if(R&&p.endsWith("/status")&&m=="POST"&&R.driverId==U.id){const nx={accepted:"arrived",arrived:"ontrip",ontrip:"completed"}[R.status];
  if(!nx||B.status!=nx)return E(r,409,"Invalid status change");R.status=nx;if(nx=="completed")R.done=now;save();return out(r,200,{ride:R})}
}
return E(r,404,"Not found")}catch(e){console.error(e);E(r,500,"Server error")}}).listen(PORT,()=>console.log("Sirkle running: rider http://localhost:"+PORT+"  driver http://localhost:"+PORT+"/driver"));
